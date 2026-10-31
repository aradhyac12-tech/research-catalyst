-- 0004: new workflow states. Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.paper_status add value if not exists 'REVIEWER_ASSIGNMENT';
alter type public.paper_status add value if not exists 'PEER_REVIEW';
alter type public.paper_status add value if not exists 'EDITORIAL_DECISION';
alter type public.paper_status add value if not exists 'WITHDRAWN';
