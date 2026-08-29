import { siteConfig, type Locale } from './site';

interface BookStructuredDataOptions {
  canonicalPath: string;
  locale: Locale;
  serial: {
    data: {
      author: string;
      coverImage?: string;
      description: string;
      publishedAt: Date;
      title: string;
      updatedAt?: Date;
    };
  };
}

export const createBookStructuredData = ({ canonicalPath, locale, serial }: BookStructuredDataOptions) => {
  const coverUrl = serial.data.coverImage
    ? new URL(serial.data.coverImage, siteConfig.baseUrl).toString()
    : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    '@id': `${new URL(canonicalPath, siteConfig.baseUrl).toString()}#book`,
    name: serial.data.title,
    description: serial.data.description,
    url: new URL(canonicalPath, siteConfig.baseUrl).toString(),
    inLanguage: locale,
    bookFormat: 'https://schema.org/EBook',
    author: {
      '@type': 'Person',
      name: serial.data.author
    },
    publisher: {
      '@type': 'Organization',
      '@id': `${siteConfig.baseUrl}/#organization`,
      name: siteConfig.name,
      url: siteConfig.baseUrl
    },
    datePublished: serial.data.publishedAt.toISOString(),
    dateModified: (serial.data.updatedAt ?? serial.data.publishedAt).toISOString(),
    ...(coverUrl ? { image: coverUrl } : {})
  };
};
