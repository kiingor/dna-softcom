import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createAgentHandler } from "../_shared/agents/handler.ts";
serve(createAgentHandler("analyst"));
