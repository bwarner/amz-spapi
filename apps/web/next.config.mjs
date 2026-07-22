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
  // Optional provider dependencies must not be bundled by webpack
  serverExternalPackages: [
    '@vercel/oidc-aws-credentials-provider',
    '@aws-sdk/credential-provider-node',
  ],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };

    // @auth0/nextjs-auth0's DPoP util uses a dynamic require webpack can't
    // statically resolve. It's harmless (server-only, resolves at runtime) but
    // noisy — and it's bundled by the Edge compiler via middleware, so
    // serverExternalPackages can't reach it. Mute just this warning.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /nextjs-auth0/,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
};

const plugins = [withNx];

export default composePlugins(...plugins)(nextConfig);
