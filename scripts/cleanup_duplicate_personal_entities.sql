-- cleanup_duplicate_personal_entities.sql
--
-- Purpose
--   A single owner ended up with multiple `personal` entities (workspaces).
--   There should be exactly ONE personal entity per owner. This script removes
--   the duplicate personal entities, KEEPING the one that actually has vendor
--   data attached (dashboard locations, and as a fallback models / legacy
--   offerings).
--
-- Why this is safe
--   * tapayoka.vendor_locations / vendor_models / offerings all reference
--     tapayoka.entities(id) with ON DELETE CASCADE. So deleting an entity that
--     holds data would DESTROY that data. This script therefore only ever
--     deletes personal entities that have ZERO locations, ZERO models and ZERO
--     legacy offerings (i.e. truly-empty duplicates).
--   * tapayoka.entity_members has NO foreign key to entities, so its rows are
--     NOT removed by cascade -- this script deletes them explicitly.
--   * The "keeper" is chosen per owner and is never deleted.
--
-- How to use
--   1. Run STEP 1 (read-only) and review the output. Confirm that for your
--      owner there is exactly one keeper (keep = true) and it is the row whose
--      location_count > 0.
--   2. Run STEP 2 inside the BEGIN/COMMIT block. It re-derives the same set,
--      so it is consistent with what STEP 1 showed. Review the NOTICE output,
--      then COMMIT (or ROLLBACK to abort).
--
-- Scope
--   Operates on every owner that has more than one personal entity. With a
--   single real user this naturally targets only that user, but it is safe to
--   run generally.

-- =====================================================================
-- STEP 1 -- INSPECT (read-only). Run this first and review.
-- =====================================================================
WITH personal_owners AS (
  -- The owner (firebase uid) of each personal entity
  SELECT m.user_id, m.entity_id
  FROM tapayoka.entity_members m
  JOIN tapayoka.entities e ON e.id = m.entity_id
  WHERE e.entity_type = 'personal'
    AND m.role = 'owner'
    AND m.is_active = true
),
counts AS (
  SELECT
    po.user_id,
    e.id            AS entity_id,
    e.entity_slug,
    e.display_name,
    e.created_at,
    (SELECT count(*) FROM tapayoka.vendor_locations vl WHERE vl.entity_id = e.id) AS location_count,
    (SELECT count(*) FROM tapayoka.vendor_models    vm WHERE vm.entity_id = e.id) AS model_count,
    (SELECT count(*) FROM tapayoka.offerings        o  WHERE o.entity_id  = e.id) AS legacy_offering_count
  FROM personal_owners po
  JOIN tapayoka.entities e ON e.id = po.entity_id
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
    count(*) OVER (PARTITION BY user_id) AS personal_entity_count
  FROM counts c
)
SELECT
  user_id,
  entity_id,
  entity_slug,
  display_name,
  created_at,
  location_count,
  model_count,
  legacy_offering_count,
  (rn = 1)                          AS keep,
  (rn <> 1 AND data_total = 0)      AS will_delete,
  (rn <> 1 AND data_total > 0)      AS skipped_has_data
FROM ranked
WHERE personal_entity_count > 1
ORDER BY user_id, rn;

-- Interpretation of STEP 1 columns:
--   keep              = this is the surviving personal entity for that owner.
--   will_delete       = empty duplicate that STEP 2 will remove.
--   skipped_has_data  = a NON-keeper that still holds data; STEP 2 will NOT
--                       delete it and will RAISE so you can resolve it manually
--                       (two data-bearing personal entities needs a human
--                       decision before merging/deleting).


-- =====================================================================
-- STEP 2 -- DELETE (transactional). Review NOTICEs, then COMMIT.
-- =====================================================================
BEGIN;

-- Re-derive keeper vs duplicates (same logic as STEP 1).
CREATE TEMP TABLE _dupe_plan ON COMMIT DROP AS
WITH personal_owners AS (
  SELECT m.user_id, m.entity_id
  FROM tapayoka.entity_members m
  JOIN tapayoka.entities e ON e.id = m.entity_id
  WHERE e.entity_type = 'personal'
    AND m.role = 'owner'
    AND m.is_active = true
),
counts AS (
  SELECT
    po.user_id,
    e.id AS entity_id,
    e.created_at,
    (SELECT count(*) FROM tapayoka.vendor_locations vl WHERE vl.entity_id = e.id) AS location_count,
    (SELECT count(*) FROM tapayoka.vendor_models    vm WHERE vm.entity_id = e.id) AS model_count,
    (SELECT count(*) FROM tapayoka.offerings        o  WHERE o.entity_id  = e.id) AS legacy_offering_count
  FROM personal_owners po
  JOIN tapayoka.entities e ON e.id = po.entity_id
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
    count(*) OVER (PARTITION BY user_id) AS personal_entity_count
  FROM counts c
)
SELECT * FROM ranked WHERE personal_entity_count > 1;

-- Guard: never delete a non-keeper that still holds data. If any exist, abort
-- so a human can decide how to merge them.
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
  FROM _dupe_plan
  WHERE rn <> 1 AND data_total > 0;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Aborting: % non-keeper personal entity(ies) still hold data. Resolve manually (see STEP 1 skipped_has_data rows).',
      bad_count;
  END IF;
END $$;

-- Report what is about to be deleted.
DO $$
DECLARE
  del_count int;
BEGIN
  SELECT count(*) INTO del_count FROM _dupe_plan WHERE rn <> 1;
  RAISE NOTICE 'Deleting % duplicate (empty) personal entity(ies).', del_count;
END $$;

-- 1) Remove membership rows for the duplicates (no FK cascade exists).
DELETE FROM tapayoka.entity_members
WHERE entity_id IN (SELECT entity_id FROM _dupe_plan WHERE rn <> 1);

-- 2) Remove the duplicate personal entities themselves. They are empty, so the
--    ON DELETE CASCADE to vendor_locations/models/offerings removes nothing.
DELETE FROM tapayoka.entities
WHERE id IN (SELECT entity_id FROM _dupe_plan WHERE rn <> 1);

-- Verify: each owner should now have exactly one personal entity.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining
  FROM (
    SELECT m.user_id
    FROM tapayoka.entity_members m
    JOIN tapayoka.entities e ON e.id = m.entity_id
    WHERE e.entity_type = 'personal' AND m.role = 'owner' AND m.is_active = true
    GROUP BY m.user_id
    HAVING count(*) > 1
  ) s;
  RAISE NOTICE 'Owners still holding duplicate personal entities: %', remaining;
END $$;

-- Review the NOTICEs above. If correct:
COMMIT;
-- Otherwise:
-- ROLLBACK;
