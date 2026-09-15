import { supabase } from "@/integrations/supabase/client";

export async function getAdmissionDocumentSignedUrl(filePath: string): Promise<string> {
  // file_url guarda o caminho no bucket privado, não uma rota do frontend.
  const { data, error } = await supabase.storage
    .from("admission-docs")
    .createSignedUrl(filePath, 300);

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Não foi possível gerar o link do documento.");

  return data.signedUrl;
}
