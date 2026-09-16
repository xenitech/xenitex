-- P1-25/SavedView: the OpenAPI contract (packages/contracts) already
-- defines the full /saved-views CRUD surface, but 0001_init.up.sql never
-- created a backing table for it -- there was nowhere for a saved view to
-- actually live.
CREATE TABLE saved_views (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  query       text NOT NULL,
  is_shared   boolean NOT NULL DEFAULT false,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_views_created_by ON saved_views(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO xenitex_app;
