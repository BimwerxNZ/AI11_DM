const designMateAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://designmate.local';

export const DesignMateFeatures = {
  call: false,
  beam: false,
  news: false,
  socialLinks: false,
  speech: false,
  streamlinedModelsSetup: true,
  serverThreads: true,
} as const;

export const DesignMateBrand = {
  titleBase: 'DesignMate',
  titleCommon: (process.env.NODE_ENV === 'development' ? '[DEV] ' : '') + 'DesignMate',
  metaDescription: 'DesignMate is the GenFEA AI design assistant. Bring your own API keys, work with DesignMate personas, and keep the experience focused on the tools you actually use.',
  siteName: 'DesignMate | GenFEA AI Design Assistant',
  themeColor: '#05d9fe',
  twitterSite: '',
  authorName: 'BIMWERX',
  authorUrl: designMateAppUrl,
  publisherName: 'BIMWERX',
  publisherUrl: designMateAppUrl,
  homeUrl: designMateAppUrl,
  cardImageUrl: process.env.NEXT_PUBLIC_CARD_IMAGE_URL?.trim() || undefined,
  openRepoUrl: 'https://github.com/BimwerxNZ/AI10',
  openProjectUrl: '',
  supportInviteUrl: '',
  privacyPolicyUrl: process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim() || `${designMateAppUrl}/privacy`,
  termsOfServiceUrl: process.env.NEXT_PUBLIC_TERMS_URL?.trim() || `${designMateAppUrl}/terms`,
  docsBaseUrl: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || `${designMateAppUrl}/docs`,
  supportFormUrl: 'https://github.com/BimwerxNZ/AI10/issues/new',
} as const;

export function designMateDocsUrl(docPage: string): string {
  return `${DesignMateBrand.docsBaseUrl.replace(/\/$/, '')}/${docPage}`;
}
