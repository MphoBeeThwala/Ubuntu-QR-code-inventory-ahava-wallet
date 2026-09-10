-- services/aml-service's POST /aml/str-file route has always written
-- strFiledAt on AmlFlag, but no migration ever added the column — it only
-- surfaced once schema.prisma was corrected enough for `prisma generate`
-- to catch the mismatch (Prisma silently allowed the extra field before
-- that, since there was no real schema to check `update()` calls against).
ALTER TABLE "aml_flags" ADD COLUMN "strFiledAt" TIMESTAMP(3);
