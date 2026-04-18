import { DesignMateBrand, designMateDocsUrl } from '~/modules/designmate/config';

/**
 * Application Identity (Brand)
 *
 * Also note that the 'Brand' is used in the following places:
 *  - README.md               all over
 *  - package.json            app-slug and version
 *  - [public/manifest.json]  name, short_name, description, theme_color, background_color
 */
export const Brand = {
  Title: {
    Base: DesignMateBrand.titleBase,
    Common: DesignMateBrand.titleCommon,
  },
  Meta: {
    Description: DesignMateBrand.metaDescription,
    SiteName: DesignMateBrand.siteName,
    ThemeColor: DesignMateBrand.themeColor,
    TwitterSite: DesignMateBrand.twitterSite,
  },
  URIs: {
    Home: DesignMateBrand.homeUrl,
    CardImage: DesignMateBrand.cardImageUrl,
    OpenRepo: DesignMateBrand.openRepoUrl,
    OpenProject: DesignMateBrand.openProjectUrl,
    SupportInvite: DesignMateBrand.supportInviteUrl,
    PrivacyPolicy: DesignMateBrand.privacyPolicyUrl,
    TermsOfService: DesignMateBrand.termsOfServiceUrl,
  },
  Docs: {
    Public: designMateDocsUrl,
  },
} as const;
