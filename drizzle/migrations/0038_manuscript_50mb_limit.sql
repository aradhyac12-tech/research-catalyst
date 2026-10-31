-- Manuscripts (PDF / .docx) may be up to 50 MB. Large files are uploaded by the browser straight to storage via a signed
-- upload URL (staging/<user-id>/...), so the bucket itself must accept them.
update storage.buckets
   set file_size_limit = 52428800
 where id = 'manuscripts';
