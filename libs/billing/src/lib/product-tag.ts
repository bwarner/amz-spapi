/**
 * Which objects in a SHARED Stripe account belong to this application.
 *
 * The account is not ours alone — ScanSafeguard and My Awesome Resume live in
 * it too, with their own products, prices and subscribers. Stripe has no notion
 * of an application boundary: every webhook endpoint on the account receives
 * every event on the account, and endpoints can only be filtered by event TYPE.
 * Since all three applications emit `customer.subscription.*`, no endpoint
 * configuration can separate them. The boundary has to be drawn in metadata,
 * and enforced by every consumer.
 *
 * `provision` stamps this tag onto the products AND the prices it creates, so
 * the tag travels on the objects a webhook payload actually carries. Reading it
 * off the price is what lets an event be attributed without a Stripe round trip
 * — and works even for a subscription somebody created by hand in the
 * dashboard, which carries none of our own metadata.
 *
 * It lives alone in this file because it was previously declared three times,
 * in `catalog`, `provision` and `verify`. Three string literals that must agree
 * forever is a coincidence waiting to end, and the failure it produces is a
 * silent one: a consumer whose copy drifted stops recognising its own products
 * and quietly ignores every event about them.
 */
export const PRODUCT_TAG = 'sellavant';

/** The metadata key the tag is stored under, on both products and prices. */
export const PRODUCT_TAG_KEY = 'product';
