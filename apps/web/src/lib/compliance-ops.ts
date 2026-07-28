import type { SellerComplianceOps } from '@amz-spapi/seller-agent';
import { loadAssetBytes, persistGeneratedImageAsset } from './media-assets';
import {
  checkImageCompliance,
  IMAGE_SPECS,
  tagSyntheticPerformer,
} from './image-compliance';

/**
 * Host implementation of marketplace image compliance checks.
 *
 * Lives apart from createImageOps so the dependency runs one way:
 * compliance-ops → image-compliance → image-ops. Folding it into
 * SellerImageOps would make image-ops import a module that imports image-ops.
 */
export function createComplianceOps(userId: string): SellerComplianceOps {
  const load = async (assetId: string) => {
    const asset = await loadAssetBytes({ userId, assetId });
    if (!asset) {
      throw new Error(
        `Asset ${assetId} not found. Use an asset id from this conversation's photos.`
      );
    }
    return asset;
  };

  return {
    supportedPlatforms: () => Object.keys(IMAGE_SPECS),
    async tagSyntheticPerformer({ assetId }) {
      const asset = await load(assetId);
      const tagged = await tagSyntheticPerformer(Buffer.from(asset.bytes));
      const saved = await persistGeneratedImageAsset({
        userId,
        dataUrl: `data:${tagged.mediaType};base64,${tagged.bytes.toString(
          'base64'
        )}`,
        feature: 'listings',
      });
      return {
        assetId: saved.assetId,
        url: `/api/a-plus/assets/${saved.assetId}`,
        alreadyTagged: tagged.alreadyTagged,
        preservedExisting: tagged.preservedExisting,
      };
    },
    async checkImage({ assetId, platform, role, containsSyntheticPerson }) {
      const asset = await load(assetId);
      return checkImageCompliance({
        bytes: Buffer.from(asset.bytes),
        platform,
        role,
        containsSyntheticPerson,
      });
    },
  };
}
