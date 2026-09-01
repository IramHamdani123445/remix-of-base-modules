# Internal Audit — Phase D Transactional Screen Matrix (2026-09-02)

Every row is a real transaction executed against the live backend with a real persona session (the same backend path the UI uses), with the resulting record re-read and asserted.

Personas: ADMIN (Audit Admin), HIA (Head of Internal Audit), LEAD (Audit Lead), MEMBER1/2 (Auditors), QA (Quality Reviewer), MGMT_BEN / MGMT_COMP / MGMT_FIN (auditee management).

Batches: A Audit Universe, B Risk, C Annual Plan, D Engagement execution to closure.

| Case | Screen | Tab | Persona | Action | Expected | Actual | Post-state | Result |
|---|---|---|---|---|---|---|---|---|
| D-B-001 | Risk Register | Register | MGMT_BEN | Create Risk (management persona, direct API) | deny | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"ia_risk_register\""} |  | **PASS** |
| D-B-002 | Risk Register | Register | ADMIN | Create Risk without mandatory title | deny | 400 {"code":"23502","details":null,"hint":null,"message":"null value in column \"risk_title\" of relation \"ia_risk_register\" violates not-null constraint"} |  | **PASS** |
| D-B-003 | Risk Register | Register | ADMIN | Create Risk with all supported fields | ok | 201 [{"id":"e2f4dbfa-125c-4881-a0bd-440a85c5bd5d","audit_universe_id":null,"risk_title":"IA-TX-20260902-RISK-01","risk_description":"Phase D controlled risk","risk_category":"Operational","inherent_li | IA-TX-20260902-RISK-01/Operational/4/4/16/Low/TX Risk Owner/Open | **PASS** |
| D-B-004 | Risk Register | Register | LEAD | Reload Risk - values preserved (TX-07/TX-08) | ok | 200 [{"id":"e2f4dbfa-125c-4881-a0bd-440a85c5bd5d","audit_universe_id":null,"risk_title":"IA-TX-20260902-RISK-01","risk_description":"Phase D controlled risk","risk_category":"Operational","inherent_li |  | **PASS** |
| D-B-005 | Risk Register | Register | ADMIN | Lossless Risk edit (notes only) | ok | 200 [{"id":"e2f4dbfa-125c-4881-a0bd-440a85c5bd5d","audit_universe_id":null,"risk_title":"IA-TX-20260902-RISK-01","risk_description":"Phase D controlled risk","risk_category":"Operational","inherent_li | LOSSLESS-EDIT-OK | **PASS** |
| D-B-006 | Risk Register | Register | ADMIN | Change likelihood - derived score/level recomputed | ok | 200 [{"id":"e2f4dbfa-125c-4881-a0bd-440a85c5bd5d","audit_universe_id":null,"risk_title":"IA-TX-20260902-RISK-01","risk_description":"Phase D controlled risk","risk_category":"Operational","inherent_li | 5x4 score=20 level=Low | **PASS** |
| D-B-007 | Risk Register | Register | ADMIN | Archive/deactivate Risk | ok | 200 [{"id":"e2f4dbfa-125c-4881-a0bd-440a85c5bd5d","audit_universe_id":null,"risk_title":"IA-TX-20260902-RISK-01","risk_description":"Phase D controlled risk","risk_category":"Operational","inherent_li | f | **PASS** |
| D-B-008 | Risk Register | Register | LEAD | Archived Risk still readable for history (TX-19) | ok | 200 [{"id":"e2f4dbfa-125c-4881-a0bd-440a85c5bd5d","risk_title":"IA-TX-20260902-RISK-01","is_active":false}] |  | **PASS** |
| D-B-009 | Risk Assessment | Assessment | MGMT_COMP | Create Risk Assessment (unauthorized) | deny | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"ia_risk_assessments\""} |  | **PASS** |
| D-B-010 | Risk Assessment | Assessment | ADMIN | Create controlled Risk Assessment | ok | 201 [{"id":"7ad2d104-2cb6-4296-99bd-6aa0d956cc14","audit_universe_id":"8f3f7471-367d-406d-aabe-b7e79b45d3bf","assessment_date":"2026-09-02","assessed_by":"IA-TX","impact_score":4.00,"likelihood_score" | 18.60/High | **PASS** |
| D-B-011 | Risk Assessment | Assessment | ADMIN | Change likelihood+impact - score/rating recomputed | ok | 200 [{"id":"7ad2d104-2cb6-4296-99bd-6aa0d956cc14","audit_universe_id":"8f3f7471-367d-406d-aabe-b7e79b45d3bf","assessment_date":"2026-09-02","assessed_by":"IA-TX","impact_score":5.00,"likelihood_score" | 5.00x5.00 overall=24.00 level=Critical | **PASS** |
| D-B-012 | Risk Assessment | Assessment | LEAD | Reload assessment after save (TX-07) | ok | 200 [{"id":"7ad2d104-2cb6-4296-99bd-6aa0d956cc14","audit_universe_id":"8f3f7471-367d-406d-aabe-b7e79b45d3bf","assessment_date":"2026-09-02","assessed_by":"IA-TX","impact_score":5.00,"likelihood_score" |  | **PASS** |
| D-B-013 | Risk Assessment | Assessment | MGMT_FIN | Unauthorized assessment mutation (direct API) | empty | 200 [] | 5.00 | **PASS** |
| D-B-014 | Risk Assessment | Entity Risk Summary | LEAD | Propagation to entity/function risk resolution | ok | 200 {"source": "risk_assessment_function", "source_id": "f7c6c3be-c93a-41c3-907d-ec7b674f3d13", "risk_score": 24.00, "risk_rating": "Critical"} |  | **PASS** |
| D-B-015 | Risk Assessment | Risk Matrix | LEAD | Risk Matrix data source reflects new assessment | ok | 200 [{"likelihood_score":5.00,"impact_score":5.00,"risk_level":"Critical"}] |  | **PASS** |
| D-B-016 | Risk Assessment | Assessment | HIA | Bulk risk recalculation command (consumer proof) | ok | 200 3 |  | **PASS** |
| D-B-017 | Risk Settings | Thresholds | LEAD | Unauthorized configuration change | empty | 200 [] |  | **PASS** |
| D-B-018 | Risk Settings | Thresholds | ADMIN | Change TEST-safe threshold value | ok | 200 [{"id":"cbc018dc-07e5-4f6e-8f08-f6f63f64f163","label":"Critical","min_score":20,"max_score":25,"color":"#7f1d1d","sort_order":4,"is_active":true,"created_at":"2026-03-10T11:15:13.689924+00:00","up | 20 | **PASS** |
| D-B-019 | Risk Settings | Thresholds | HIA | Consumer re-evaluation after configuration change | ok | 200 3 | 4 | **PASS** |
| D-B-020 | Risk Settings | Thresholds | ADMIN | Restore original TEST configuration value | ok | 200 [{"min_score":21}] | 21 | **PASS** |
