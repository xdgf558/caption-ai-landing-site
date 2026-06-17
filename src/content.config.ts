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

const serials = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    seriesSlug: z.string(),
    author: z.string().default('Station Cat'),
    description: z.string(),
    subtitle: z.string().optional(),
    tagline: z.string(),
    status: z.enum(['planned', 'serializing', 'completed', 'paused']).default('planned'),
    language: z.enum(['zh-Hant', 'zh-Hans', 'en', 'ja']).default('zh-Hant'),
    updateSchedule: z.string().optional(),
    tags: z.array(z.string()).default([]),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    coverLabel: z.string().optional(),
    featured: z.boolean().default(false),
    priceMode: z.enum(['free', 'tip-optional', 'chapter-paid', 'volume-paid', 'member']).default('free'),
    freeChapters: z.number().default(0),
    latestChapterSlug: z.string().optional(),
    latestChapterNumber: z.number().optional(),
    totalPlannedChapters: z.number().optional(),
    availabilityNote: z.string().optional(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional()
  })
});

const serialChapters = defineCollection({
  type: 'content',
  schema: z.object({
    seriesSlug: z.string(),
    chapterNumber: z.number(),
    chapterSlug: z.string(),
    title: z.string(),
    excerpt: z.string(),
    status: z.enum(['draft', 'scheduled', 'published']).default('draft'),
    access: z.enum(['free', 'paid', 'supporter']).default('free'),
    language: z.enum(['zh-Hant', 'zh-Hans', 'en', 'ja']).default('zh-Hant'),
    wordCount: z.number().optional(),
    readingMinutes: z.number().optional(),
    publishedAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
    nextChapterSlug: z.string().optional(),
    prevChapterSlug: z.string().optional(),
    volume: z.string().optional()
  })
});

export const collections = { devlog, serials, serialChapters };
