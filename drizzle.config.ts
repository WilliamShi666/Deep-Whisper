import { defineConfig } from 'drizzle-kit';
export default defineConfig({dialect:'sqlite',schema:'./src/storage/database/shared/all-schema.ts',out:'./src/storage/database/generated',dbCredentials:{url:'./data/deep-whisper.sqlite'}});
