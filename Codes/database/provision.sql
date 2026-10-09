-- Run as a PostgreSQL superuser:  psql -v app_password='...' -f database/provision.sql
SELECT format('CREATE ROLE launchlens_app LOGIN PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'launchlens_app')\gexec
SELECT 'CREATE DATABASE launchlens OWNER launchlens_app'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'launchlens')\gexec
\c launchlens
CREATE EXTENSION IF NOT EXISTS postgis;
GRANT ALL ON SCHEMA public TO launchlens_app;
