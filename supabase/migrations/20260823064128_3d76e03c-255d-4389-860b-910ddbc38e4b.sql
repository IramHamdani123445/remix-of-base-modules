ALTER TABLE public.core_payment_arrangement_item
  ALTER COLUMN principal_amount DROP NOT NULL,
  ALTER COLUMN penalty_amount DROP NOT NULL,
  ALTER COLUMN cost_amount DROP NOT NULL;