-- Omni-Comms: business-oriented template classification metadata.

CREATE TABLE IF NOT EXISTS public.omni_comms_business_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  display_order integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_code, code)
);

GRANT ALL ON public.omni_comms_business_object TO service_role;
ALTER TABLE public.omni_comms_business_object ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.omni_comms_event_definition
  ADD COLUMN IF NOT EXISTS business_object_code text,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 1000;

UPDATE public.omni_comms_event_definition
   SET business_object_code = entity_type
 WHERE business_object_code IS NULL;

INSERT INTO public.omni_comms_business_object (module_code, code, name, display_order)
SELECT DISTINCT e.module_code, e.entity_type,
       initcap(replace(lower(e.entity_type), '_', ' ')),
       1000
  FROM public.omni_comms_event_definition e
ON CONFLICT (module_code, code) DO NOTHING;

WITH seed(code, name, ord) AS (
  VALUES ('CLAIM','Claims',10), ('MEANS_TEST','Eligibility & means test',20),
         ('AWARD','Awards',30), ('PAYMENT','Payments',40), ('APPEAL','Appeals',50),
         ('MEDICAL_REVIEW','Medical',60), ('LIFE_CERTIFICATE','Life certificates',70),
         ('OVERPAYMENT','Overpayments',80), ('MORTALITY','Mortality',90),
         ('RISK','Risk & fraud',100)
)
UPDATE public.omni_comms_business_object b
   SET name = seed.name, display_order = seed.ord, updated_at = now()
  FROM seed
 WHERE b.module_code = 'BENEFITS' AND b.code = seed.code;

WITH ord(suffix, ord) AS (
  VALUES ('SUBMITTED',10), ('RECEIVED',20), ('EVIDENCE_REQUESTED',30), ('EVIDENCE_RECEIVED',40),
         ('UNDER_REVIEW',50), ('APPROVED',60), ('REJECTED',70), ('DISALLOWED',75),
         ('WITHDRAWN',80), ('SUSPENDED',90), ('REINSTATED',100), ('CLOSED',110)
)
UPDATE public.omni_comms_event_definition e
   SET display_order = ord.ord
  FROM ord
 WHERE e.module_code = 'BENEFITS'
   AND e.business_object_code = 'CLAIM'
   AND e.code LIKE '%.' || ord.suffix;

CREATE INDEX IF NOT EXISTS omni_comms_event_definition_business_object_idx
  ON public.omni_comms_event_definition (module_code, business_object_code, display_order);