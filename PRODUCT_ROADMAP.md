# Product Roadmap: Seller Assistant

**Vision**: Conversational Amazon operations copilot - "Perplexity for Amazon Sellers"

**Business Model**: Pure SaaS - $49-199/mo subscriptions

**Strategy**: Fully proprietary (no open source complications)

---

## Table of Contents
1. [Authorization Strategy](#authorization-strategy)
2. [13-Week MVP Roadmap](#13-week-mvp-roadmap)
3. [Technical Implementation](#technical-implementation)
4. [Success Metrics](#success-metrics)
5. [Investment & Revenue](#investment--revenue)

---

## Authorization Strategy

### Two Separate OAuth Patterns

#### Pattern 1: CLI Self-Authorization ✅ (Current - Keep As-Is)

**What**: Users create their own LWA credentials
```bash
# User runs this locally
./spcli.sh credentials add

# Process:
1. Starts Express server on localhost:3000
2. Opens browser → Amazon consent screen
3. User approves
4. Amazon redirects to http://localhost:3000/oauth/callback
5. Exchanges code for tokens
6. Saves to local SQLite (~/.amazon-seller-assistant/credentials.db)
7. Shuts down server
```

**When to use**: CLI tools, power users, developers

**Implementation**: Already complete in `apps/oauth-server/`

---

#### Pattern 2: Web SaaS Authorization 🚀 (Need to Build)

**What**: Users authorize YOUR app to access their data

**User Flow**:
```
1. User clicks "Connect Amazon Account" in web app
2. Redirect to Amazon's consent screen
3. User approves YOUR app
4. Amazon redirects to https://yourapp.com/api/auth/sp-api/callback
5. Exchange code for tokens
6. Save to YOUR Couchbase (multi-tenant)
7. Redirect to dashboard
```

**Key Differences**:

| Aspect | CLI (Local OAuth) | Web SaaS (Cloud OAuth) |
|--------|------------------|------------------------|
| **Server** | localhost:3000 | Production app (Vercel) |
| **Redirect URI** | `http://localhost:3000/oauth/callback` | `https://yourapp.com/api/auth/sp-api/callback` |
| **Credentials** | User's own LWA app | YOUR LWA app (shared by all users) |
| **Storage** | User's local SQLite | Your Couchbase (multi-tenant) |
| **Use Case** | CLI power users | Web UI for all users |
| **Registration** | Each user registers | You register once |

---

## 13-Week MVP Roadmap

### Phase 1: Core Infrastructure (Weeks 1-2)

#### Week 1: SP-API Foundation
**Goal**: Complete core SP-API operations

**Tasks**:
1. **Orders API**
   ```bash
   ./spcli.sh orders list --last-7-days
   ./spcli.sh orders get 123-456-789 --include-items
   ./spcli.sh orders export --month 2025-01 --format csv
   ```

2. **Fees API**
   ```bash
   ./spcli.sh fees estimate B0DFGKXTBZ --price 29.99
   ./spcli.sh fees batch < asins.txt
   ```

3. **Inventory API**
   ```bash
   ./spcli.sh inventory summary
   ./spcli.sh inventory fba --low-stock
   ./spcli.sh inventory aged --days 365
   ```

**Deliverable**: Internal tools ready, APIs tested

---

#### Week 2: Documentation & Setup
**Goal**: Prepare for OAuth registration

**Tasks**:
1. **Legal Documents**
   - Privacy Policy (use Termly.io)
   - Terms of Service
   - Data Processing Agreement (GDPR compliance)

2. **Infrastructure**
   - Register domain: sellerassistant.ai
   - SSL certificates (Vercel auto-handles)
   - Auth0 setup for user authentication

3. **Landing Page**
   - Hero: "AI Copilot for Amazon Sellers"
   - Problem/Solution sections
   - Waitlist signup form
   - Demo video (Loom screencast)

4. **Register LWA Applications**
   - **SP-API App**:
     ```
     Name: Seller Assistant
     Privacy Policy: https://sellerassistant.ai/privacy
     Redirect URI: https://sellerassistant.ai/api/auth/sp-api/callback
     Permissions: Orders, Catalog, Inventory, Fees, Finances
     ```

   - **Ads API App**:
     ```
     Name: Seller Assistant Ads
     Privacy Policy: https://sellerassistant.ai/privacy
     Redirect URI: https://sellerassistant.ai/api/auth/ads/callback
     Permissions: Campaign Management, Analytics
     ```

**Deliverable**: LWA apps submitted (2-4 week approval wait)

---

### Phase 2: Campaign Management (Weeks 3-4)

#### Week 3: Campaign Import/Export (HIGH VALUE FEATURE)
**Goal**: Solve "spreadsheet hell" problem for Amazon Ads

**Schema Design**:
```json
{
  "campaign": {
    "name": "Q1 Coffee Makers",
    "campaignType": "sponsoredProducts",
    "targetingType": "AUTO",
    "budget": { "amount": 50, "type": "DAILY" },
    "bidding": {
      "strategy": "AUTO_FOR_SALES",
      "adjustments": { "bidAdjustmentPercentage": 50 }
    },
    "schedule": {
      "startDate": "2025-02-01",
      "endDate": "2025-03-31"
    },
    "adGroups": [
      {
        "name": "Auto - Close Match",
        "defaultBid": 0.75,
        "state": "ENABLED",
        "products": [
          { "asin": "B001", "customBid": 0.85 },
          { "asin": "B002" }
        ],
        "targets": [
          {
            "type": "KEYWORD",
            "value": "glass teapot",
            "matchType": "EXACT",
            "bid": 1.25,
            "state": "ENABLED"
          }
        ],
        "negativeTargets": [
          {
            "type": "KEYWORD",
            "value": "plastic",
            "matchType": "NEGATIVE_PHRASE"
          }
        ]
      }
    ]
  },
  "metadata": {
    "version": "1.0",
    "description": "Q1 product launch campaign",
    "tags": ["launch", "teapot", "2025-Q1"]
  }
}
```

**Implementation**:
- Create `CampaignConfigSchema` in `packages/ad-models/`
- Zod validation with detailed error messages
- Implement import/export service in `packages/ad-client/`

**CLI Commands**:
```bash
# Validate without creating
./adscli.sh campaigns import campaign.json --dry-run

# Create campaign
./adscli.sh campaigns import campaign.json

# Export existing campaign
./adscli.sh campaigns export camp_12345 > campaign.json

# Show differences before updating
./adscli.sh campaigns diff campaign.json camp_12345

# Template with variables
./adscli.sh campaigns import template.json \
  --var BUDGET=100 \
  --var ASIN=B001 \
  --var START_DATE=2025-02-01
```

**Deliverable**: Campaign import/export working end-to-end

---

#### Week 4: Template Library & Bulk Operations
**Goal**: Make campaign creation 10x faster

**Templates** (in `examples/campaign-templates/`):
1. **auto-launch.json** - New product launch (auto targeting)
2. **competitor-targeting.json** - ASIN targeting competitors
3. **keyword-exact.json** - Exact match keyword campaign
4. **keyword-phrase.json** - Phrase match keyword campaign
5. **branded-defense.json** - Brand protection campaign
6. **clearance.json** - End-of-season promotional campaign

**Bulk Operations**:
```bash
# Pause multiple campaigns
./adscli.sh campaigns pause camp_123,camp_456,camp_789

# Update bids from CSV
./adscli.sh keywords update-bids keywords.csv

# Generate campaigns from product CSV
./adscli.sh campaigns generate-from-csv products.csv \
  --template auto-launch.json \
  --output campaigns/
```

**Deliverable**: Template library + bulk operations working

---

### Phase 3: LWA Registration & Web UI (Weeks 5-8)

#### Week 5-6: Profit Calculator (MVP Web UI)
**Goal**: First monetizable feature - "How much did I really make?"

**Data Pipeline**:
```typescript
const profit = await calculateProfit({
  orders: await spcli.getOrders({ last30Days: true }),
  fees: await spcli.getFees(asins),
  adSpend: await adscli.getCampaignSpend({ last30Days: true }),
  cogs: userInputCOGS, // Manual CSV upload initially
});

// Result:
{
  revenue: 50000,
  fees: 12500,      // Amazon fees
  adSpend: 7500,    // Ad spend
  cogs: 20000,      // Cost of goods
  grossProfit: 30000,  // revenue - fees - adSpend
  netProfit: 10000,    // grossProfit - cogs
  margin: 20,          // netProfit / revenue
}
```

**UI Screens**:
```
/dashboard
  - Total Revenue (last 30 days)
  - Amazon Fees breakdown
  - Ad Spend (linked to campaigns)
  - COGS input (manual CSV upload)
  - = Net Profit
  - Margin % chart

/products
  - Per-ASIN profit breakdown
  - Sort by: revenue, profit, margin %
  - Filter: unprofitable, low margin
  - Export to CSV

/trends
  - Revenue/profit over time (7/30/90 days)
  - Ad efficiency trend (ACOS)
  - Top 10 products by profit
  - Margin compression alerts
```

**Tech Stack**:
- Next.js 15 (app router)
- Auth0 (user authentication)
- Couchbase (historical data storage)
- shadcn/ui (UI components)
- Recharts (profit charts)

**Monetization**:
- Free tier: Last 30 days only, no historical
- Pro tier ($49/mo): Unlimited historical + alerts

**Deliverable**: Profit calculator MVP with 10 beta users

---

#### Week 7-8: Web OAuth Implementation
**Goal**: "Connect Amazon Account" button works

**File Structure**:
```
apps/web/
├── app/
│   ├── api/
│   │   └── auth/
│   │       ├── sp-api/
│   │       │   ├── route.ts           # Initiates OAuth
│   │       │   └── callback/
│   │       │       └── route.ts       # Handles callback
│   │       └── ads/
│   │           ├── route.ts
│   │           └── callback/
│   │               └── route.ts
│   ├── dashboard/
│   │   └── page.tsx                   # Connection status
│   └── login/
│       └── page.tsx                   # Auth0 login
└── lib/
    ├── amazon-auth.ts                 # Token exchange
    └── db.ts                          # Couchbase client
```

**Implementation**:

**`apps/web/app/api/auth/sp-api/route.ts`**:
```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

export async function GET() {
  // Generate CSRF state token
  const state = crypto.randomBytes(32).toString('hex');

  // Store in secure cookie
  cookies().set('sp_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  });

  // Build Amazon authorization URL
  const authUrl = new URL('https://sellercentral.amazon.com/apps/authorize/consent');
  authUrl.searchParams.set('application_id', process.env.SP_API_APP_ID!);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('version', 'beta');

  return NextResponse.redirect(authUrl.toString());
}
```

**`apps/web/app/api/auth/sp-api/callback/route.ts`**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import { exchangeCodeForTokens, saveCredentials } from '@/lib/amazon-auth';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get('spapi_oauth_code');
  const state = params.get('state');
  const sellerId = params.get('selling_partner_id');

  // 1. Verify CSRF state
  const storedState = cookies().get('sp_oauth_state')?.value;
  if (!state || state !== storedState) {
    return NextResponse.redirect('/dashboard?error=invalid_state');
  }

  // 2. Get current logged-in user (Auth0 session)
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.redirect('/login');
  }

  try {
    // 3. Exchange auth code for tokens
    const tokens = await exchangeCodeForTokens({
      code: code!,
      clientId: process.env.SP_API_CLIENT_ID!,
      clientSecret: process.env.SP_API_CLIENT_SECRET!,
    });

    // 4. Save to Couchbase (multi-tenant storage)
    await saveCredentials({
      userId: session.user.id,
      apiType: 'SP_API',
      sellerId: sellerId!,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      marketplaceId: 'ATVPDKIKX0DER',
      region: 'NA',
    });

    // 5. Redirect to dashboard
    return NextResponse.redirect('/dashboard?connected=sp-api');

  } catch (error) {
    console.error('OAuth error:', error);
    return NextResponse.redirect('/dashboard?error=oauth_failed');
  }
}
```

**`apps/web/lib/amazon-auth.ts`**:
```typescript
import axios from 'axios';
import { credentialStore } from './db';

export async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
}) {
  const response = await axios.post(
    'https://api.amazon.com/auth/o2/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  return {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
    expires_in: response.data.expires_in,
  };
}

export async function saveCredentials(params: {
  userId: string;
  apiType: 'SP_API' | 'ADS_API';
  sellerId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  marketplaceId: string;
  region: string;
}) {
  // Use existing credential store with multi-tenant support
  await credentialStore.setProfile({
    profile_name: `${params.apiType}_${params.userId}`,
    api_type: params.apiType,
    user_id: params.userId, // ← Multi-tenant key
    seller_id: params.sellerId,
    client_id: process.env.SP_API_CLIENT_ID!, // YOUR app credentials
    client_secret: process.env.SP_API_CLIENT_SECRET!,
    refresh_token: params.refreshToken,
    access_token: params.accessToken,
    access_token_expires_at: params.expiresAt,
    marketplace_id: params.marketplaceId,
    region: params.region,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
}

export async function getConnectionStatus(userId: string) {
  const spApiProfile = await credentialStore.getProfile(
    `SP_API_${userId}`,
    'SP_API'
  );
  const adsApiProfile = await credentialStore.getProfile(
    `ADS_API_${userId}`,
    'ADS_API'
  );

  return {
    spApiConnected: !!spApiProfile,
    adsApiConnected: !!adsApiProfile,
    sellerId: spApiProfile?.seller_id,
  };
}
```

**UI Components**:

**`components/ConnectAmazonButton.tsx`**:
```tsx
'use client';

export function ConnectAmazonButton() {
  return (
    <button
      onClick={() => window.location.href = '/api/auth/sp-api'}
      className="bg-[#FF9900] hover:bg-[#FF9900]/90 text-white px-6 py-3 rounded-lg flex items-center gap-2"
    >
      <svg className="w-5 h-5">
        {/* Amazon logo SVG */}
      </svg>
      Connect Amazon Seller Account
    </button>
  );
}
```

**`app/dashboard/page.tsx`**:
```tsx
import { getServerSession } from 'next-auth';
import { getConnectionStatus } from '@/lib/amazon-auth';
import { ConnectAmazonButton } from '@/components/ConnectAmazonButton';

export default async function DashboardPage() {
  const session = await getServerSession();
  const connections = await getConnectionStatus(session!.user.id);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {!connections.spApiConnected && (
        <div className="border rounded-lg p-6 mb-4 bg-yellow-50">
          <h2 className="text-lg font-semibold mb-2">
            Connect Your Amazon Seller Account
          </h2>
          <p className="text-gray-600 mb-4">
            Connect your account to view orders, inventory, and profit data.
          </p>
          <ConnectAmazonButton />
        </div>
      )}

      {connections.spApiConnected && (
        <div className="border border-green-500 rounded-lg p-6 bg-green-50">
          <h2 className="text-lg font-semibold text-green-700 mb-2">
            ✓ Amazon Seller Account Connected
          </h2>
          <p className="text-gray-600">
            Seller ID: {connections.sellerId}
          </p>
          <button
            onClick={() => {/* TODO: Disconnect flow */}}
            className="mt-4 text-sm text-red-600 hover:text-red-700"
          >
            Disconnect Account
          </button>
        </div>
      )}

      {/* Profit calculator content here */}
    </div>
  );
}
```

**Security Checklist**:
- ✅ CSRF state validation (required)
- ✅ Encrypt refresh tokens at rest (KMS)
- ✅ HTTPS only in production
- ✅ HttpOnly, Secure cookies
- ✅ Row-level security (users see only their data)
- ✅ Audit logs for token access

**Deliverable**: OAuth flow working (after Amazon approval)

---

### Phase 4: AI Copilot (Weeks 9-11)

#### Week 9: Chat Interface (MVP)
**Goal**: "Ask questions about your business"

**5 Core Questions**:
```
1. "What was my profit last week?"
   → Fetch orders, fees, ad spend → calculate → show breakdown

2. "Which products are unprofitable?"
   → Calculate margin % for all products → rank worst first

3. "Should I restock ASIN B0DFGKXTBZ?"
   → Check: inventory level, sales velocity, lead time, margin
   → Recommendation with reasoning

4. "Why is my rank dropping for ASIN B001?"
   → Analyze: sales trend, price changes, review changes, buy box
   → Show root cause analysis

5. "Compare my price to competitors for B002"
   → Fetch buy box, top 5 offers → show comparison table
```

**Architecture**:
```typescript
// Tool definitions for Claude
const tools = [
  {
    name: 'get_orders',
    description: 'Fetch orders for a date range',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' },
      },
    },
    handler: async (params) => {
      const client = await createSpApiClient(userId);
      return client.getOrders(params);
    }
  },
  {
    name: 'get_fees',
    description: 'Get Amazon fees for ASINs',
    handler: async (asins) => {
      const client = await createSpApiClient(userId);
      return client.getFees(asins);
    }
  },
  {
    name: 'get_ad_spend',
    description: 'Get advertising spend for a period',
    handler: async (params) => {
      const client = await createAdsApiClient(userId);
      return client.getCampaignSpend(params);
    }
  },
  {
    name: 'calculate_profit',
    description: 'Calculate profit from revenue, fees, ads, COGS',
    handler: async (params) => {
      return {
        revenue: params.revenue,
        fees: params.fees,
        adSpend: params.adSpend,
        cogs: params.cogs,
        netProfit: params.revenue - params.fees - params.adSpend - params.cogs,
        margin: ((params.revenue - params.fees - params.adSpend - params.cogs) / params.revenue) * 100,
      };
    }
  },
  {
    name: 'get_inventory',
    description: 'Get current inventory levels',
    handler: async () => {
      const client = await createSpApiClient(userId);
      return client.getInventory();
    }
  },
  {
    name: 'get_catalog_item',
    description: 'Get product details including rank, price, reviews',
    handler: async (asin) => {
      const client = await createSpApiClient(userId);
      return client.getCatalogItem(asin, {
        includedData: ['summaries', 'salesRanks', 'offers'],
      });
    }
  },
];

// Chat endpoint
export async function POST(request: Request) {
  const { message, conversationId } = await request.json();
  const session = await getServerSession();

  // Get conversation history from DB
  const history = await getConversationHistory(conversationId);

  // Call Claude with tools
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    tools,
    messages: [
      ...history,
      { role: 'user', content: message }
    ],
  });

  // Execute tool calls
  if (response.stop_reason === 'tool_use') {
    const toolResults = await executeToolCalls(response.content);

    // Continue conversation with tool results
    const finalResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      tools,
      messages: [
        ...history,
        { role: 'user', content: message },
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ],
    });

    return finalResponse;
  }

  return response;
}
```

**UI**:
```tsx
// app/chat/page.tsx
'use client';

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  const sendMessage = async () => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: input }),
    });

    const data = await response.json();
    setMessages([...messages,
      { role: 'user', content: input },
      { role: 'assistant', content: data.content }
    ]);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
            <div className="inline-block p-4 rounded-lg bg-gray-100">
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about your business..."
          className="w-full p-2 border rounded"
        />
      </div>
    </div>
  );
}
```

**Deliverable**: Chat working for 5 questions with 50 beta users

---

#### Week 10-11: Advanced AI Features
**Goal**: Make AI indispensable

**Expanded Tool Library** (20+ tools):
- Campaign CRUD (create, update, pause, archive)
- Keyword research (suggestions based on performance)
- Price recommendations (competitive analysis)
- Inventory forecasting (predict stockout dates)
- Review sentiment analysis
- Competitor tracking
- Profitability what-if scenarios

**Proactive Insights**:
```typescript
// Background job runs every hour
async function generateProactiveInsights(userId: string) {
  const insights = [];

  // Check for rank drops
  const rankChanges = await detectRankChanges(userId);
  if (rankChanges.significant.length > 0) {
    insights.push({
      type: 'RANK_DROP',
      severity: 'HIGH',
      title: `Rank dropped 50% for ASIN ${rankChanges.significant[0].asin}`,
      message: await generateRankDropAnalysis(rankChanges.significant[0]),
      actions: ['adjust_price', 'check_inventory', 'review_ads'],
    });
  }

  // Check for stockouts
  const lowInventory = await detectLowInventory(userId);
  if (lowInventory.critical.length > 0) {
    insights.push({
      type: 'STOCKOUT_RISK',
      severity: 'HIGH',
      title: `${lowInventory.critical.length} products at risk of stockout`,
      message: `Based on sales velocity, you'll run out in 7-10 days`,
      actions: ['reorder_inventory', 'view_details'],
    });
  }

  // Save insights to DB
  await saveInsights(userId, insights);

  // Send notifications
  await sendNotifications(userId, insights);
}
```

**Multi-turn Conversations**:
```
User: "Show my top products by profit"
AI: [Fetches data, calculates profit, shows top 10]

User: "Filter to just teapots"
AI: [Filters list based on category/keywords]

User: "Create ad campaigns for the top 3"
AI: [Generates campaign configs]
    "I've created 3 campaign configs. Review them?"
    [Shows campaign JSON previews]

User: "Yes, create them"
AI: [Calls campaign import API]
    "✓ Created 3 campaigns:
     - Camp_12345: Auto - Glass Teapot
     - Camp_12346: Auto - Clear Teapot
     - Camp_12347: Auto - Borosilicate Teapot"
```

**Deliverable**: Full AI copilot with 20+ tools

---

### Phase 5: Automation & Launch (Weeks 12-13)

#### Week 12: Email Triage & Alerts
**Goal**: Automate customer service

**Email Parsing** (SES Inbound):
```typescript
// Lambda triggered by SES inbound
export async function handleInboundEmail(event: SESEvent) {
  const email = parseEmail(event);

  // Classify email type
  const classification = await classifyEmail(email);
  // Types: RETURN, REVIEW_THREAT, SHIPPING_QUESTION, PRODUCT_QUESTION

  // Extract order ID
  const orderId = extractOrderId(email.body);

  // Fetch order details
  const order = orderId ? await getOrder(orderId) : null;

  // Generate suggested reply
  const suggestedReply = await generateReply({
    email,
    classification,
    order,
  });

  // Create task in DB
  await createTask({
    userId: lookupUserByEmail(email.to),
    type: classification.type,
    orderId,
    priority: classification.urgent ? 'HIGH' : 'NORMAL',
    subject: email.subject,
    body: email.body,
    suggestedReply,
  });

  // Send notification
  await sendNotification(userId, {
    title: `New ${classification.type} email`,
    message: email.subject,
  });
}
```

**Reply Generation**:
```typescript
const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  messages: [{
    role: 'user',
    content: `Generate a professional reply to this customer email:

Subject: ${email.subject}
Body: ${email.body}

Order Details: ${JSON.stringify(order)}

Policy:
- Returns accepted within 30 days
- Prepaid return label for defective items
- Refund processed within 5-7 business days

Tone: Professional, empathetic, helpful`
  }]
});
```

**Automated Alerts**:
- Low stock warnings (< 7 days supply)
- Price drop alerts (competitor undercut you)
- Negative review notifications (< 4 stars)
- ACOS spike warnings (> target by 20%)
- Rank drop alerts (> 50% drop)
- Inventory age alerts (> 365 days)

**Deliverable**: Email triage + alerts working

---

#### Week 13: Polish & Launch
**Goal**: Public launch

**Infrastructure Checklist**:
- ✅ Rate limiting (respect Amazon API quotas)
- ✅ Error monitoring (Sentry)
- ✅ Performance monitoring (Vercel Analytics)
- ✅ CloudWatch dashboards (API errors, latency)
- ✅ Automated backups (Couchbase daily snapshots)
- ✅ Database indexes (query optimization)
- ✅ CDN for assets (CloudFront)

**Security Checklist**:
- ✅ HTTPS everywhere
- ✅ CSRF protection
- ✅ Rate limiting per user
- ✅ SQL injection prevention (use parameterized queries)
- ✅ XSS prevention (sanitize inputs)
- ✅ Token encryption (KMS)
- ✅ Audit logs (track all API calls)
- ✅ Compliance docs (privacy policy, terms)

**Pricing Tiers**:

**Free Trial**: 14 days, full access

**Pro: $49/mo**
- Unlimited AI questions
- Historical data (unlimited)
- Campaign import/export
- Email triage (500 emails/month)
- Automated alerts
- 10,000 API calls/day
- 1 Amazon account

**Enterprise: $199/mo**
- Everything in Pro
- Multi-account management (10 accounts)
- Team collaboration (5 users)
- Priority support (24hr response)
- White-label option
- API access (custom integrations)
- Unlimited API calls
- Dedicated account manager

**Launch Strategy**:

**Day 1-2: Soft Launch**
- Email 100 waitlist subscribers
- Offer: First 50 users get Pro at $29/mo lifetime

**Day 3-4: Product Hunt**
- Launch on Wednesday (best day)
- Prepare: Demo video, screenshots, founder story
- Goal: #1 Product of the Day

**Day 5-6: Social Media**
- Reddit (r/FulfillmentByAmazon, r/AmazonSeller)
- Twitter/X launch thread
- LinkedIn post
- YouTube demo walkthrough

**Day 7: Press Outreach**
- TechCrunch (pitch: AI for SMB e-commerce)
- eCommerceFuel newsletter
- MyWifeQuitHerJob podcast
- Indie Hackers showcase

**Goal**: 100 users, $2,900 MRR by end of Week 13

**Deliverable**: Public launch complete

---

## Technical Implementation Details

### Web OAuth Flow (Detailed)

**Registration URLs**:
- SP-API: https://sellercentral.amazon.com/apps/authorize/consent
- Ads API: https://advertising.amazon.com/API/docs/en-us/setting-up/overview

**Environment Variables**:
```bash
# SP-API OAuth (YOUR app - shared by all users)
SP_API_CLIENT_ID=amzn1.application-oa2-client.xxxxx
SP_API_CLIENT_SECRET=xxxxx
SP_API_APP_ID=xxxxx  # Received after approval

# Ads API OAuth (YOUR app - shared by all users)
ADS_API_CLIENT_ID=amzn1.application-oa2-client.yyyyy
ADS_API_CLIENT_SECRET=yyyyy

# Auth0 (user authentication)
AUTH0_DOMAIN=yourapp.auth0.com
AUTH0_CLIENT_ID=xxxxx
AUTH0_CLIENT_SECRET=xxxxx

# Database
COUCHBASE_CONNECTION_STRING=couchbases://xxxxx.cloud.couchbase.com
COUCHBASE_USERNAME=admin
COUCHBASE_PASSWORD=xxxxx
COUCHBASE_BUCKET=seller_assistant

# AI
ANTHROPIC_API_KEY=sk-ant-xxxxx

# AWS (for SES, KMS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
KMS_KEY_ID=xxxxx  # For encrypting refresh tokens
```

**Multi-Tenant Data Model**:
```typescript
// Couchbase document structure
{
  "type": "amazon_credentials",
  "user_id": "auth0|12345",  // ← Partition key
  "api_type": "SP_API",
  "seller_id": "A1B2C3D4E5F6G7",
  "profile_name": "SP_API_auth0|12345",

  // YOUR app credentials (shared)
  "client_id": "amzn1.application-oa2-client.xxxxx",
  "client_secret": "xxxxx",  // Encrypted with KMS

  // User's tokens (from OAuth)
  "refresh_token": "Atzr|xxxxx",  // Encrypted with KMS
  "access_token": "Atza|xxxxx",   // Encrypted with KMS
  "access_token_expires_at": 1738368000000,

  "marketplace_id": "ATVPDKIKX0DER",
  "region": "NA",
  "created_at": 1706832000000,
  "updated_at": 1738368000000
}
```

**Row-Level Security**:
```typescript
// Always filter by user_id
async function getCredentials(userId: string, apiType: 'SP_API' | 'ADS_API') {
  const result = await collection.get(`${apiType}_${userId}`);

  // Verify ownership
  if (result.content.user_id !== userId) {
    throw new Error('Unauthorized access');
  }

  return result.content;
}

// Audit log all access
async function auditLog(action: string, userId: string, resource: string) {
  await auditCollection.insert({
    timestamp: Date.now(),
    action,
    userId,
    resource,
    ip: getClientIp(),
  });
}
```

---

## Success Metrics

### User Acquisition

| Week | Users | Paying Users | MRR | Notes |
|------|-------|--------------|-----|-------|
| 5 | 5 | 0 | $0 | Private beta (free) |
| 8 | 25 | 0 | $0 | OAuth approved, onboarding |
| 9 | 50 | 5 | $245 | First paying customers |
| 10 | 75 | 15 | $735 | AI copilot launches |
| 11 | 100 | 30 | $1,470 | Word-of-mouth growth |
| 13 | 150 | 50 | $2,450 | Public launch |
| 16 | 250 | 100 | $4,900 | Product Hunt boost |
| 20 | 400 | 200 | $9,800 | Steady growth |
| 26 | 600 | 300 | $15,000 | Established product |

### Key Metrics to Track

**Product Metrics**:
- DAU/MAU ratio (target: > 30%)
- Average questions per user per day (target: 5+)
- Tool usage distribution (which tools are most valuable?)
- API error rate (target: < 1%)
- Response time p95 (target: < 500ms)

**Business Metrics**:
- MRR growth rate (target: 20%+ MoM)
- Churn rate (target: < 5% monthly)
- Customer acquisition cost (CAC)
- Lifetime value (LTV)
- LTV/CAC ratio (target: > 3)

**Engagement Metrics**:
- Time to first value (TTFV) (target: < 5 minutes)
- Activation rate (connected Amazon account) (target: > 80%)
- Feature adoption (% users using each feature)
- NPS score (target: > 50)

---

## Investment & Revenue

### Costs (First 13 Weeks)

**Infrastructure**:
- AWS: $200/mo × 3 = $600
  - Lambda, API Gateway, SES, KMS
  - CloudWatch, S3
- Vercel Pro: $20/mo × 3 = $60
  - Hosting, CDN, Analytics
- Anthropic API: $500/mo × 3 = $1,500
  - Claude API calls (avg 10k/day)
- Auth0 Essentials: $240/mo × 3 = $720
  - User authentication
- Couchbase Capella: $150/mo × 3 = $450
  - Managed database
- Domain + Email: $100
- Tools (Sentry, etc): $200

**Total: ~$3,630**

### Revenue Projections

**Conservative Case**:
- Week 13: 50 users (40 Pro @ $49, 2 Ent @ $199) = $2,358 MRR
- Week 26: 200 users (170 Pro, 10 Ent) = $10,320 MRR
- Year 1: 500 users (450 Pro, 25 Ent) = $27,025 MRR = **$324k ARR**

**Optimistic Case**:
- Week 13: 100 users = $5,090 MRR
- Week 26: 400 users = $20,400 MRR
- Year 1: 1000 users = $53,900 MRR = **$647k ARR**

**Breakeven**: ~7 customers at $49/mo = Week 9

**Profitability**: 50% gross margin by Week 16 (after infra costs)

---

## Why No Open Source?

**Challenges with Monorepo Open Source**:
1. **Code leakage**: Hard to selectively publish parts
2. **Security exposure**: Proprietary logic visible
3. **Patent trolls**: Risk of IP theft
4. **Support burden**: Community expects free support
5. **Competitor advantage**: Easy to clone your work
6. **License complexity**: Managing multiple licenses
7. **Slower shipping**: Need to generalize everything

**Benefits of Fully Proprietary**:
1. ✅ **Faster development**: No need to abstract/generalize
2. ✅ **Better security**: Code is private
3. ✅ **Clear monetization**: No OSS confusion
4. ✅ **Competitive moat**: Harder to replicate
5. ✅ **Focus**: Build for paying customers, not GitHub stars
6. ✅ **IP protection**: Your innovations stay yours

**Alternative Marketing**:
- Instead of GitHub stars → Product Hunt, Reddit, YouTube
- Instead of npm downloads → Case studies, ROI calculators
- Instead of contributors → Partner ecosystem

---

## Next Steps

### This Week (Week 1):
1. ✅ Complete Orders API in spcli
2. ✅ Complete Fees API in spcli
3. ✅ Complete Inventory API in spcli
4. Test end-to-end with real data

### Next Week (Week 2):
1. Draft privacy policy (use Termly.io template)
2. Register domain (sellerassistant.ai or alternative)
3. Create landing page (Next.js + shadcn/ui)
4. Start LWA app registration (SP-API + Ads API)

### Week 3:
1. Design campaign import schema (Zod)
2. Implement campaign importer class
3. Build CLI commands (import/export/diff)
4. Create template library

---

## Questions & Decisions

### Open Questions:
- [ ] Domain name finalized? (sellerassistant.ai, amazoncopilot.ai, etc)
- [ ] Pricing finalized? ($49 vs $69 for Pro tier?)
- [ ] Free tier limits? (30 days vs 7 days historical?)
- [ ] Enterprise features priority?

### Key Decisions Made:
- ✅ **No open source** - Full proprietary to ship faster
- ✅ **Two OAuth flows** - CLI (self-auth) + Web (app auth)
- ✅ **AI-first** - Conversational UI is the differentiator
- ✅ **Campaign import** - High-value feature for early users
- ✅ **Profit calculator** - First monetizable feature

---

## References

- [Amazon SP-API Documentation](https://developer-docs.amazon.com/sp-api/)
- [Amazon Ads API Documentation](https://advertising.amazon.com/API/docs/en-us)
- [LWA OAuth Guide](https://developer-docs.amazon.com/sp-api/docs/authorizing-selling-partner-api-applications)
- [Claude Tool Use Documentation](https://docs.anthropic.com/claude/docs/tool-use)

---

**Last Updated**: 2025-01-30
**Status**: Week 1 - Orders/Fees/Inventory APIs in progress
**Next Milestone**: LWA app registration (Week 2)
