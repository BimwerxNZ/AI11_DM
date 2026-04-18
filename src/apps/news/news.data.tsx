import * as React from 'react';

import { Release } from '~/common/app.release';


type NewsItem = {
  versionCode: string;
  versionName?: string;
  versionDate?: Date;
  text?: string | React.JSX.Element;
  items?: {
    text: React.ReactNode;
    dev?: boolean;
  }[];
};

const frontendBuild = Release.buildInfo('frontend');
const frontendPkgVersion = frontendBuild.pkgVersion ?? 'designmate/main';

export const newsFrontendTimestamp = frontendBuild.timestamp;

export const DevNewsItem: NewsItem = {
  versionCode: 'DEV',
  versionName: 'Development Build',
  items: [
    { text: <>You&apos;re running a DesignMate developer build: <b>{frontendPkgVersion}</b>.</> },
    { text: <>This page only exists as a lightweight placeholder because the DesignMate deployment disables the upstream news flow.</> },
  ],
};

export const NewsItems: NewsItem[] = [
  {
    versionCode: '2.0.4',
    versionName: 'DesignMate',
    versionDate: new Date('2026-04-19T00:00:00Z'),
    items: [
      { text: <>DesignMate branding replaces the upstream Big-AGI identity across the runtime shell.</> },
      { text: <>Call, Beam, speech, news, and social surfaces are disabled in this deployment.</> },
      { text: <>Desktop API foundations are enabled for GenFEA-managed server-backed threads.</> },
    ],
  },
];
