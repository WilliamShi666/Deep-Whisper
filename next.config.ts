import type {NextConfig} from 'next';
const nextConfig:NextConfig={
 allowedDevOrigins:['127.0.0.1','localhost'],
 distDir:process.env.NEXT_DIST_DIR?.trim()||'.next',serverExternalPackages:['better-sqlite3','nodemailer'],
 outputFileTracingIncludes:{'/*':['./node_modules/better-sqlite3/build/Release/better_sqlite3.node']},
 images:{remotePatterns:[{protocol:'https',hostname:'*',pathname:'/**'}]},
};
export default nextConfig;
