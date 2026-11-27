-- Store studio milestones (counter stats) and career openings in PostgreSQL
-- so About/Home/Career pages load all studio data strictly from DB.
ALTER TABLE "studio_about_profile"
  ADD COLUMN IF NOT EXISTS "milestones" JSONB,
  ADD COLUMN IF NOT EXISTS "career_roles" JSONB;

UPDATE "studio_about_profile"
SET "milestones" = '[
  {"label":"Since","target":2015,"suffix":"","startFrom":1995},
  {"label":"Events","target":1500,"suffix":"+","startFrom":0},
  {"label":"Photos","target":80,"suffix":"k+","startFrom":0},
  {"label":"Clients","target":40,"suffix":"k+","startFrom":0}
]'::jsonb
WHERE "milestones" IS NULL;

UPDATE "studio_about_profile"
SET "career_roles" = '[
  {"title":"Lead & Associate Wedding Photographer","type":"Full-Time / Event Crew • Feni & Travel","summary":"Documentary bridal portraiture, Holud color storytelling, candid guest moments, and natural-light composition."},
  {"title":"Wedding Cinematographer","type":"Full-Time / Project Basis • Feni & Chattogram","summary":"Multi-camera ceremony filmmaking, gimbal movement, audio capture, and narrative highlight shooting."},
  {"title":"Photo Retoucher & Highlight Film Editor","type":"Studio / Hybrid • Feni Studio","summary":"True-to-life Lightroom color grading, digital album curation, and DaVinci / Premiere wedding film pacing."}
]'::jsonb
WHERE "career_roles" IS NULL;
