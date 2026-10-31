-- Run this file on its own. A new enum value cannot be used in the same transaction that adds it, so the
-- permission rows for the role live in 0018.
alter type public.app_role add value if not exists 'founder';
