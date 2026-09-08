import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Default templates used when no custom template exists in DB
const DEFAULT_TEMPLATES: Record<string, { message: string; enabled: boolean }> = {
  collaborator_registered: {
    message: "Olá {nome}! 👋\n\nBem-vindo(a) à *{empresa}*! 🎉\n\nEstamos muito felizes em te ter no time! 🚀\n\nPara completar seu cadastro, acesse o link abaixo e preencha seus dados:\n👉 {link_primeiro_acesso}\n\nQualquer dúvida, estamos aqui! 💬",
    enabled: true,
  },
  documents_approved: {
    message: "Parabéns {nome}! 🎊\n\nSeu cadastro foi *aprovado com sucesso*! ✅\n\nAgora você já faz parte oficialmente da equipe *{empresa}*! 🏆\n\nAcesse o Portal do Colaborador para ver seus dados:\n👉 {link_portal}\n\nSeja muito bem-vindo(a)! 🤗",
    enabled: true,
  },
  documents_rejected: {
    message: "Olá {nome}! 👋\n\nPrecisamos da sua atenção! ⚠️\n\nAlguns documentos do seu cadastro na *{empresa}* precisam de ajustes.\n\nAcesse o link abaixo para verificar e reenviar:\n👉 {link_primeiro_acesso}\n\nEstamos torcendo por você! 💪",
    enabled: true,
  },
  exam_created: {
    message: "Olá {nome}! 👋\n\nUm novo exame ocupacional foi agendado pra você na *{empresa}*! 🏥\n\n📋 Tipo: *{tipo_exame}*\n📅 Data limite: *{data_exame}*\n\nFique atento(a) ao prazo! ⏰\nQualquer dúvida, fale com o RH. 💬",
    enabled: true,
  },
  vacation_starting: {
    message: "Olá {nome}! 👋\n\nSuas férias foram aprovadas! 🏖️\n\n📅 Período: *{data_inicio}* a *{data_fim}*\n\nAproveite bastante esse descanso merecido! 😎☀️\n\nA equipe *{empresa}* deseja ótimas férias! 🌴",
    enabled: true,
  },
  payslip_available: {
    message: "Olá {nome}! 👋\n\nSeu contracheque de *{mes}/{ano}* já está disponível no Portal do Colaborador! 💰\n\nAcesse para conferir:\n👉 {link_portal}\n\nBom trabalho! 👏",
    enabled: true,
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  // A Evolution chama o webhook de fora, então a URL precisa ser a pública.
  // No self-hosted SUPABASE_URL é o gateway interno (http://api-gw:8000), que a
  // Evolution não alcança; na Supabase Cloud não existe SUPABASE_PUBLIC_URL e o
  // fallback devolve o comportamento atual.
  const SUPABASE_PUBLIC_URL = Deno.env.get("SUPABASE_PUBLIC_URL") || SUPABASE_URL;

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return new Response(
      JSON.stringify({ error: "EvolutionAPI not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("Authorization");
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader || "" } },
  });

  try {
    const body = await req.json();
    const { action, company_id, ...params } = body;

    // Verify user belongs to company (skip for send_notification which can be called internally)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = EVOLUTION_API_URL.replace(/\/$/, "");
    const headers = {
      "Content-Type": "application/json",
      apikey: EVOLUTION_API_KEY,
    };

    switch (action) {
      case "create_instance": {
        const instanceName = `meurh_${company_id.replace(/-/g, "").slice(0, 16)}`;
        
        // Get the webhook URL
        const functionUrl = `${SUPABASE_PUBLIC_URL}/functions/v1/whatsapp-webhook`;

        const res = await fetch(`${baseUrl}/instance/create`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            instanceName,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true,
            webhook: {
              url: functionUrl,
              byEvents: false,
              base64: false,
              headers: { "x-company-id": company_id },
              events: ["CONNECTION_UPDATE"],
            },
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(`EvolutionAPI error: ${JSON.stringify(data)}`);
        }

        // Save instance to DB using service role
        const serviceClient = createClient(
          SUPABASE_URL,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        await serviceClient.from("whatsapp_instances").upsert({
          company_id,
          instance_name: instanceName,
          instance_id: data.instance?.instanceId || data.instance?.instanceName || instanceName,
          status: "connecting",
        }, { onConflict: "company_id" });

        return new Response(JSON.stringify({ success: true, instance: data, instanceName }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get_qrcode": {
        const { instance_name } = params;
        const res = await fetch(`${baseUrl}/instance/connect/${instance_name}`, {
          method: "GET",
          headers,
        });

        const data = await res.json();
        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check_status": {
        const { instance_name } = params;
        const res = await fetch(`${baseUrl}/instance/connectionState/${instance_name}`, {
          method: "GET",
          headers,
        });

        const data = await res.json();
        
        // Update status in DB
        if (data.instance?.state) {
          const serviceClient = createClient(
            SUPABASE_URL,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
          );
          await serviceClient
            .from("whatsapp_instances")
            .update({ status: data.instance.state })
            .eq("company_id", company_id);
        }

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "disconnect_instance": {
        const { instance_name } = params;
        const res = await fetch(`${baseUrl}/instance/logout/${instance_name}`, {
          method: "DELETE",
          headers,
        });

        const data = await res.json();

        // Update status in DB
        const serviceClient = createClient(
          SUPABASE_URL,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await serviceClient
          .from("whatsapp_instances")
          .update({ status: "close", phone_number: null })
          .eq("company_id", company_id);

        return new Response(JSON.stringify({ success: true, data }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete_instance": {
        const { instance_name } = params;
        
        // Try to delete from EvolutionAPI (ignore errors if instance doesn't exist)
        try {
          await fetch(`${baseUrl}/instance/delete/${instance_name}`, {
            method: "DELETE",
            headers,
          });
        } catch (_e) {
          // Ignore - instance may not exist on Evolution side
        }

        // Delete from DB
        const serviceClient = createClient(
          SUPABASE_URL,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        await serviceClient
          .from("whatsapp_instances")
          .delete()
          .eq("company_id", company_id);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "send_notification": {
        const { collaborator_id, event_type } = params;

        const serviceClient = createClient(
          SUPABASE_URL,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Get instance
        const { data: instance } = await serviceClient
          .from("whatsapp_instances")
          .select("*")
          .eq("company_id", company_id)
          .eq("status", "open")
          .maybeSingle();

        if (!instance) {
          console.log("No active WhatsApp instance for company:", company_id);
          return new Response(
            JSON.stringify({ success: false, reason: "no_instance" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get template from DB first, fall back to defaults
        const { data: dbTemplate } = await serviceClient
          .from("notification_templates")
          .select("*")
          .eq("company_id", company_id)
          .eq("event_type", event_type)
          .maybeSingle();

        // Use DB template if exists, otherwise use default
        const template = dbTemplate
          ? { message_template: dbTemplate.message_template, is_enabled: dbTemplate.is_enabled }
          : DEFAULT_TEMPLATES[event_type]
            ? { message_template: DEFAULT_TEMPLATES[event_type].message, is_enabled: DEFAULT_TEMPLATES[event_type].enabled }
            : null;

        if (!template || !template.is_enabled) {
          console.log("Template disabled or not found for event:", event_type);
          return new Response(
            JSON.stringify({ success: false, reason: "template_disabled" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get collaborator
        const { data: collaborator } = await serviceClient
          .from("collaborators")
          .select("name, phone, email, cpf")
          .eq("id", collaborator_id)
          .single();

        if (!collaborator?.phone) {
          console.log("Collaborator has no phone:", collaborator_id);
          await serviceClient.from("notification_logs").insert({
            company_id,
            collaborator_id,
            event_type,
            message_sent: template.message_template,
            status: "no_phone",
            error_message: "Colaborador sem telefone cadastrado",
          });
          return new Response(
            JSON.stringify({ success: false, reason: "no_phone" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get company name
        const { data: company } = await serviceClient
          .from("companies")
          .select("company_name")
          .eq("id", company_id)
          .single();

        // Replace template variables
        let message = template.message_template;
        // URL pública do app (ex.: https://dna.softcom.com.br). Configurada via
        // `supabase secrets set APP_URL=...` — sem ela os links das mensagens
        // sairiam quebrados, então falha cedo.
        const publishedUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
        if (!publishedUrl) {
          return new Response(
            JSON.stringify({ success: false, reason: "app_url_not_configured" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        message = message.replace(/{nome}/g, collaborator.name || "");
        message = message.replace(/{empresa}/g, company?.company_name || "");
        message = message.replace(/{link_primeiro_acesso}/g, `${publishedUrl}/primeiro-acesso`);
        message = message.replace(/{link_portal}/g, `${publishedUrl}/colaborador`);

        // Replace extra variables from params
        if (params.variables) {
          for (const [key, value] of Object.entries(params.variables)) {
            message = message.replace(new RegExp(`{${key}}`, "g"), String(value));
          }
        }

        // Clean phone number - keep only digits and add country code
        let phone = collaborator.phone.replace(/\D/g, "");
        if (!phone.startsWith("55")) {
          phone = "55" + phone;
        }

        console.log(`Sending WhatsApp to ${phone} for event ${event_type}`);

        // Send message via EvolutionAPI
        const res = await fetch(`${baseUrl}/message/sendText/${instance.instance_name}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            number: phone,
            text: message,
          }),
        });

        const sendResult = await res.json();
        const status = res.ok ? "sent" : "failed";

        console.log(`WhatsApp send result: ${status}`, sendResult);

        // Log the notification
        await serviceClient.from("notification_logs").insert({
          company_id,
          collaborator_id,
          event_type,
          phone_number: phone,
          message_sent: message,
          status,
          error_message: res.ok ? null : JSON.stringify(sendResult),
        });

        return new Response(
          JSON.stringify({ success: res.ok, status, data: sendResult }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("WhatsApp API error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
