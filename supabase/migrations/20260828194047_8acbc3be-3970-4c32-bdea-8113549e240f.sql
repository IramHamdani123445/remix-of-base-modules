CREATE OR REPLACE FUNCTION public.ia_comms_profile_fact(p_role text, p_profile_id uuid, p_fallback_name text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p.id IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      p_role,
      jsonb_build_object(
        -- DEF-S1B-43: platform recipient vocabulary is user|contact|group|external|system|synthetic_test
        'recipient_type','user',
        'recipient_reference', p.id::text,
        'display_name', coalesce(nullif(btrim(p.full_name),''), p_fallback_name, 'Recipient'),
        'email', nullif(btrim(coalesce(p.email,'')),'')
      )
    )
  END
  FROM public.profiles p
  WHERE p.id = p_profile_id;
$function$;