//@ts-check

import { composePlugins, withNx } from '@nx/next';

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  nx: {
    svgr: false,
  },
  // Transpile workspace packages for Next.js bundler compatibility
  transpilePackages: [
    '@amz-spapi/ai-provider',
    '@amz-spapi/seller-agent',
    '@amz-spapi/sp-cache',
    '@amz-spapi/couchbase-utils',
    '@farvisionllc/sp-client',
    '@farvisionllc/credential-store',
    '@farvisionllc/models',
    'react-markdown',
    'remark-gfm',
  ],
  // Native modules and optional provider dependencies must not be bundled by webpack
  serverExternalPackages: [
    'couchbase',
    '@vercel/oidc-aws-credentials-provider',
    '@aws-sdk/credential-provider-node',
  ],
  webpack: (config, context) => {
    if (context.isServer) {
      config.externals = [...config.externals, { couchbase: 'commonjs couchbase' }];
    }
    return config;
  },
};

const plugins = [
  withNx,
];

export default composePlugins(...plugins)(nextConfig);
