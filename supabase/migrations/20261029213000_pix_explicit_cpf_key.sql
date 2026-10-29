-- Uma chave CPF confirmada, mas diferente do documento cadastral, era enviada
-- como telefone (+55). A máscara CPF completa passa a declarar o tipo.
-- Números sem máscara mantêm a regra anterior; não inferir CPF pelo checksum.
-- Sem backfill: colunas GENERATED STORED e snapshots existentes são preservados.
-- Uma correção de cadastro autorizada deve formatar apenas a chave confirmada;
-- o trigger existente sincroniza somente linhas ainda disponíveis para PIX.
BEGIN;

CREATE OR REPLACE FUNCTION public.pix_key_type(p_key text, p_cpf text)
RETURNS public.pix_key_type
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_raw        text := btrim(coalesce(p_key, ''));
  v_digits     text;
  v_sum        integer;
  v_check      integer;
  v_pos        integer;
  v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
BEGIN
  -- Chave vazia/nula não é erro: é cadastro incompleto, que o RH resolve depois.
  -- Devolver NULL (e não estourar) mantém a coluna gerada gravável pra todo
  -- mundo — inclusive pros colaboradores que a sync importa sem PIX.
  IF v_raw = '' THEN
    RETURN NULL;
  END IF;

  -- E-mail primeiro: é o único formato que pode conter dígitos e ainda assim
  -- não ser número nenhum. Regex simples de propósito (tem @, tem ponto no
  -- domínio, não tem espaço) — validar e-mail "de verdade" por regex é ilusão.
  IF v_raw ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RETURN 'email';
  END IF;

  -- EVP (chave aleatória) é UUID v4 pela especificação do BCB. Cobramos a
  -- versão e a variante: um UUID de outra versão aqui é quase certamente algo
  -- que não veio do DICT.
  IF lower(v_raw) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN 'evp';
  END IF;

  -- Daqui pra baixo a chave só pode ser numérica. Aceitamos a pontuação que o
  -- humano digita (123.456.789-09, (11) 98765-4321, +55 11 ...); qualquer letra
  -- sobrando significa que não é CPF/CNPJ/telefone — e é melhor devolver NULL
  -- do que classificar errado.
  IF v_raw !~ '^\+?[-0-9 ()./]+$' THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');

  -- A máscara completa declara CPF explicitamente, sem usar o documento do
  -- colaborador para adivinhar o tipo da chave. Validar formato/checksum não
  -- comprova titularidade nem existência no DICT.
  IF v_raw ~ '^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$' THEN
    IF v_digits = repeat(left(v_digits, 1), 11) THEN
      RETURN NULL;
    END IF;
    v_sum := 0;
    FOR v_pos IN 1..9 LOOP
      v_sum := v_sum + substr(v_digits, v_pos, 1)::integer * (11 - v_pos);
    END LOOP;
    v_check := (v_sum * 10) % 11;
    IF v_check = 10 THEN v_check := 0; END IF;
    IF v_check <> substr(v_digits, 10, 1)::integer THEN RETURN NULL; END IF;

    v_sum := 0;
    FOR v_pos IN 1..10 LOOP
      v_sum := v_sum + substr(v_digits, v_pos, 1)::integer * (12 - v_pos);
    END LOOP;
    v_check := (v_sum * 10) % 11;
    IF v_check = 10 THEN v_check := 0; END IF;
    IF v_check <> substr(v_digits, 11, 1)::integer THEN RETURN NULL; END IF;
    RETURN 'cpf';
  END IF;

  -- DESEMPATE SEM MÁSCARA — 11 dígitos é CPF **ou** celular:
  -- os dois são 11 dígitos. A regra é comparar com o CPF do próprio
  -- colaborador: determinística, auditável e explicável numa reunião ("o
  -- sistema disse CPF porque bate com o CPF dele").
  --
  -- CONSEQUÊNCIA CONHECIDA, de propósito: colaborador com `cpf` NULL (a coluna
  -- virou nullable em 20260525143000 pra sync) e chave de 11 dígitos cai em
  -- 'phone'. Não há como desempatar sem inventar heurística. Isso é RISCO REAL
  -- de pagamento: se a chave era o CPF dele, o gateway vai procurar no DICT um
  -- telefone que pode pertencer a OUTRA pessoa. Mitigação é de produto, não de
  -- schema: quem for pagar precisa ter CPF cadastrado. Um CHECK aqui travaria a
  -- sync, que é justamente quem cria essas linhas incompletas.
  IF length(v_digits) = 11 THEN
    IF length(v_cpf_digits) = 11 AND v_cpf_digits = v_digits THEN
      RETURN 'cpf';
    END IF;
    RETURN 'phone';
  END IF;

  IF length(v_digits) = 14 THEN
    RETURN 'cnpj';
  END IF;

  -- 10 dígitos = DDD + fixo. 12/13 com 55 na frente = o mesmo número já com
  -- DDI. Um 12/13 que NÃO começa com 55 seria telefone estrangeiro: cai no
  -- NULL do fim, porque folha de CLT com chave de fora do Brasil é bem mais
  -- provável ser erro de digitação do que caso real.
  IF length(v_digits) = 10
     OR (length(v_digits) IN (12, 13) AND left(v_digits, 2) = '55') THEN
    RETURN 'phone';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.pix_key_type(text, text) IS
  'Classifica a chave PIX. Máscara CPF explícita e checksum válido prevalecem sobre o CPF cadastral; máscara CPF inválida retorna NULL. Sem máscara, 11 dígitos iguais ao CPF cadastral são cpf; os demais são phone. Não consulta titularidade nem registro DICT.';

-- A importação externa pode reenviar a mesma chave sem pontuação. Não perder
-- uma declaração CPF já confirmada por uma mudança apenas de apresentação.
-- Outro número, vazio/null ou telefone explícito (+55/DDD) continua editável.
CREATE OR REPLACE FUNCTION public.preserve_explicit_pix_cpf()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF btrim(OLD.pix_key) ~ '^[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}$'
     AND public.pix_key_type(OLD.pix_key, OLD.cpf) = 'cpf'
     AND btrim(NEW.pix_key) ~ '^[0-9]{11}$'
     AND btrim(NEW.pix_key) = regexp_replace(OLD.pix_key, '[^0-9]', '', 'g') THEN
    NEW.pix_key := OLD.pix_key;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_explicit_pix_cpf() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_preserve_explicit_pix_cpf ON public.collaborators;
CREATE TRIGGER trg_preserve_explicit_pix_cpf
  BEFORE UPDATE OF pix_key ON public.collaborators
  FOR EACH ROW EXECUTE FUNCTION public.preserve_explicit_pix_cpf();

COMMIT;

-- ROLLBACK
-- Restaura a função anterior. Não reescrever cadastros/snapshots em massa:
-- qualquer reversão de dados precisa revalidar pagamentos e tentativas ativas.
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_preserve_explicit_pix_cpf ON public.collaborators;
-- DROP FUNCTION IF EXISTS public.preserve_explicit_pix_cpf();
-- CREATE OR REPLACE FUNCTION public.pix_key_type(p_key text, p_cpf text)
-- RETURNS public.pix_key_type
-- LANGUAGE plpgsql
-- IMMUTABLE
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_raw        text := btrim(coalesce(p_key, ''));
--   v_digits     text;
--   v_cpf_digits text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
-- BEGIN
--   -- Chave vazia/nula não é erro: é cadastro incompleto, que o RH resolve depois.
--   -- Devolver NULL (e não estourar) mantém a coluna gerada gravável pra todo
--   -- mundo — inclusive pros colaboradores que a sync importa sem PIX.
--   IF v_raw = '' THEN
--     RETURN NULL;
--   END IF;
--
--   -- E-mail primeiro: é o único formato que pode conter dígitos e ainda assim
--   -- não ser número nenhum. Regex simples de propósito (tem @, tem ponto no
--   -- domínio, não tem espaço) — validar e-mail "de verdade" por regex é ilusão.
--   IF v_raw ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
--     RETURN 'email';
--   END IF;
--
--   -- EVP (chave aleatória) é UUID v4 pela especificação do BCB. Cobramos a
--   -- versão e a variante: um UUID de outra versão aqui é quase certamente algo
--   -- que não veio do DICT.
--   IF lower(v_raw) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
--     RETURN 'evp';
--   END IF;
--
--   -- Daqui pra baixo a chave só pode ser numérica. Aceitamos a pontuação que o
--   -- humano digita (123.456.789-09, (11) 98765-4321, +55 11 ...); qualquer letra
--   -- sobrando significa que não é CPF/CNPJ/telefone — e é melhor devolver NULL
--   -- do que classificar errado.
--   IF v_raw !~ '^\+?[-0-9 ()./]+$' THEN
--     RETURN NULL;
--   END IF;
--
--   v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
--
--   -- DESEMPATE CRÍTICO — 11 dígitos é CPF **ou** celular, e a forma não decide:
--   -- os dois são 11 dígitos. A regra é comparar com o CPF do próprio
--   -- colaborador: determinística, auditável e explicável numa reunião ("o
--   -- sistema disse CPF porque bate com o CPF dele").
--   --
--   -- CONSEQUÊNCIA CONHECIDA, de propósito: colaborador com `cpf` NULL (a coluna
--   -- virou nullable em 20260525143000 pra sync) e chave de 11 dígitos cai em
--   -- 'phone'. Não há como desempatar sem inventar heurística. Isso é RISCO REAL
--   -- de pagamento: se a chave era o CPF dele, o gateway vai procurar no DICT um
--   -- telefone que pode pertencer a OUTRA pessoa. Mitigação é de produto, não de
--   -- schema: quem for pagar precisa ter CPF cadastrado. Um CHECK aqui travaria a
--   -- sync, que é justamente quem cria essas linhas incompletas.
--   IF length(v_digits) = 11 THEN
--     IF length(v_cpf_digits) = 11 AND v_cpf_digits = v_digits THEN
--       RETURN 'cpf';
--     END IF;
--     RETURN 'phone';
--   END IF;
--
--   IF length(v_digits) = 14 THEN
--     RETURN 'cnpj';
--   END IF;
--
--   -- 10 dígitos = DDD + fixo. 12/13 com 55 na frente = o mesmo número já com
--   -- DDI. Um 12/13 que NÃO começa com 55 seria telefone estrangeiro: cai no
--   -- NULL do fim, porque folha de CLT com chave de fora do Brasil é bem mais
--   -- provável ser erro de digitação do que caso real.
--   IF length(v_digits) = 10
--      OR (length(v_digits) IN (12, 13) AND left(v_digits, 2) = '55') THEN
--     RETURN 'phone';
--   END IF;
--
--   RETURN NULL;
-- END;
-- $$;
--
-- COMMENT ON FUNCTION public.pix_key_type(text, text) IS
--   'Classifica a chave PIX. NULL = não classificável (vazia ou fora dos formatos do DICT). O 2º argumento é o CPF do colaborador e existe só pra desempatar os 11 dígitos: bate com o CPF dele → cpf; senão → phone. Sem CPF cadastrado, 11 dígitos viram phone.';
-- COMMIT;
