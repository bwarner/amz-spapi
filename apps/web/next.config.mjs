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
    '@amz-spapi/billing',
    '@amz-spapi/couchbase-utils',
    '@amz-spapi/identity',
    '@farvisionllc/sp-client',
    '@farvisionllc/credential-store',
    '@farvisionllc/models',
    'react-markdown',
    'remark-gfm',
  ],
  // Optional provider dependencies must not be bundled by webpack
  serverExternalPackages: [
    '@aws-sdk/credential-provider-node',
    // Pino's pretty transport runs in a worker thread it spawns by resolving a
    // module path at runtime. Bundled, that path points inside the webpack
    // output and the worker fails to start — taking the first log line with it.
    // Must load from node_modules.
    'pino',
    'pino-pretty',
    'thread-stream',
    // Background removal: native ONNX runtime + model files resolved relative
    // to the package dir — bundling breaks both. Must load from node_modules.
    '@imgly/background-removal-node',
    'onnxruntime-node',
    // PDF rendering: resolves font metrics and other data files relative to
    // the package dir at runtime — load from node_modules, don't bundle.
    '@react-pdf/renderer',
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
