import { defineCollection, z } from 'astro:content';

const devlog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    postSlug: z.string().optional(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    status: z.enum(['building', 'testing', 'shipped', 'note', 'maintenance']).default('note'),
    language: z.enum(['zh-Hant', 'zh-Hans', 'en', 'ja']).default('zh-Hant'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false)
  })
});

const xworks = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    xUrl: z.string().url(),
    type: z.enum(['video', 'post', 'image', 'thread']).default('post'),
    tags: z.array(z.string()).default([]),
    language: z.enum(['en', 'ja', 'zh-hant']).default('en'),
    featured: z.boolean().default(false),
    status: z.enum(['draft', 'published']).default('draft'),
    sortOrder: z.number().default(100),
    publishedAt: z.string().optional()
  })
});

export const collections = { devlog, xworks };
