'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function NewProductPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [brandName, setBrandName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!title.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          brandName: brandName.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        product?: { productId: string };
        error?: string;
      };
      if (!res.ok || !body.product) {
        throw new Error(body.error || 'Could not create product.');
      }
      // Land on the new product's detail page.
      router.push(`/products/${body.product.productId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create product.'
      );
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Products
      </Link>

      <h1 className="mb-1 text-2xl font-bold">New product</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Create a platform-independent product manually. Only a title is
        required; you can add listings and assets afterward.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="title" className="mb-1 block text-sm font-medium">
              Title <span className="text-red-600">*</span>
            </label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
              }}
              placeholder="e.g. 40oz Insulated Travel Tumbler"
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="brand" className="mb-1 block text-sm font-medium">
              Brand <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="brand"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Brand name"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="mb-1 block text-sm font-medium"
            >
              Description{' '}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short internal description of the product"
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={() => void create()}
              disabled={creating || !title.trim()}
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Create product
            </Button>
            <Button asChild type="button" variant="ghost">
              <Link href="/products">Cancel</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
