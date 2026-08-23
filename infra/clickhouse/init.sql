CREATE DATABASE IF NOT EXISTS vantegra;

CREATE TABLE IF NOT EXISTS vantegra.portal_events
(
    occurred_at DateTime,
    event_type LowCardinality(String),
    project_id String,
    link_id String,
    ip_truncated String,
    user_agent String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (project_id, occurred_at)
TTL occurred_at + INTERVAL 180 DAY DELETE;

CREATE TABLE IF NOT EXISTS vantegra.portal_visits_daily
(
    day Date,
    project_id String,
    count AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
ORDER BY (project_id, day);

CREATE MATERIALIZED VIEW IF NOT EXISTS vantegra.portal_visits_daily_mv
TO vantegra.portal_visits_daily
AS
SELECT
    toDate(occurred_at) AS day,
    project_id,
    countState() AS count
FROM vantegra.portal_events
WHERE event_type = 'visit'
GROUP BY day, project_id;