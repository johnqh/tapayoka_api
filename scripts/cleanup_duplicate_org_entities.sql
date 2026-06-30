-- cleanup_duplicate_org_entities.sql
--
-- Context
--   A single owner accumulated multiple auto-created organization entities
--   (one per pass through the TOS / create-entity flow). Only one holds vendor
--   data; the rest are empty duplicates that should be removed.
--
-- Policy (from the owner): keep the organization that has dashboard location
--   data; delete the empty duplicates belonging to the same owner.
--
-- Safety
--   * vendor_locations / vendor_models / offerings reference entities(id) with
--     ON DELETE CASCADE, so this script only ever deletes organizations that
--     have ZERO of each. A guard aborts the transaction if a non-keeper still
--     holds data.
--   * entity_members has no FK to entities, so its rows are deleted explicitly.
--   * Only owners that have MORE THAN ONE organization are touched, so a single
--     legitimate organization is never deleted.
--
-- Run inside the BEGIN/COMMIT below; review the NOTICEs, then COMMIT.

BEGIN;

CREATE TEMP TABLE _org_plan ON COMMIT DROP AS
WITH org_owners AS (
  SELECT m.user_id, m.entity_id
  FROM tapayoka.entity_members m
  JOIN tapayoka.entities e ON e.id = m.entity_id
  WHERE e.entity_type = 'organization'
    AND m.role = 'owner'
    AND m.is_active = true
),
counts AS (
  SELECT
    o.user_id,
    e.id AS entity_id,
    e.entity_slug,
    e.created_at,
    (SELECT count(*) FROM tapayoka.vendor_locations vl WHERE vl.entity_id = e.id) AS location_count,
    (SELECT count(*) FROM tapayoka.vendor_models    vm WHERE vm.entity_id = e.id) AS model_count,
    (SELECT count(*) FROM tapayoka.offerings        ofr WHERE ofr.entity_id = e.id) AS legacy_offering_count
  FROM org_owners o
  JOIN tapayoka.entities e ON e.id = o.entity_id
),
ranked AS (
  SELECT
    c.*,
    (location_count + model_count + legacy_offering_count) AS data_total,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY location_count DESC,
               (location_count + model_count + legacy_offering_count) DESC,
               created_at ASC,
               entity_id ASC
    ) AS rn,
    count(*) OVER (PARTITION BY user_id) AS org_count
  FROM counts c
)
SELECT * FROM ranked WHERE org_count > 1;

\echo '=== Plan (keep = rn 1; delete = rn>1 and empty) ==='
SELECT entity_id, entity_slug, created_at, location_count, model_count,
       legacy_offering_count, (rn = 1) AS keep, (rn <> 1) AS delete_candidate
FROM _org_plan ORDER BY user_id, rn;

-- Guard: never delete a non-keeper that still holds data.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM _org_plan WHERE rn <> 1 AND data_total > 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Aborting: % non-keeper organization(s) still hold data.', bad;
  END IF;
END $$;

DO $$
DECLARE del int;
BEGIN
  SELECT count(*) INTO del FROM _org_plan WHERE rn <> 1;
  RAISE NOTICE 'Deleting % empty duplicate organization(s).', del;
END $$;

-- 1) Remove membership rows for the duplicates (no FK cascade).
DELETE FROM tapayoka.entity_members
WHERE entity_id IN (SELECT entity_id FROM _org_plan WHERE rn <> 1);

-- 2) Remove the empty duplicate organizations.
DELETE FROM tapayoka.entities
WHERE id IN (SELECT entity_id FROM _org_plan WHERE rn <> 1);

\echo '=== Remaining organizations after cleanup ==='
SELECT e.id, e.entity_slug, e.display_name,
       (SELECT count(*) FROM tapayoka.vendor_locations vl WHERE vl.entity_id = e.id) AS loc,
       (SELECT count(*) FROM tapayoka.vendor_models vm WHERE vm.entity_id = e.id) AS mdl
FROM tapayoka.entities e
WHERE e.entity_type = 'organization'
ORDER BY e.created_at;

COMMIT;
