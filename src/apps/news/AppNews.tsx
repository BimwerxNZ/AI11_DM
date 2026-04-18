import * as React from 'react';
import TimeAgo from 'react-timeago';

import { Box, Button, Card, CardContent, Container, Sheet, Typography } from '@mui/joy';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { getBackendCapabilities } from '~/modules/backend/store-backend-capabilities';

import { Link } from '~/common/components/Link';
import { ROUTE_INDEX } from '~/common/app.routes';
import { Release } from '~/common/app.release';
import { animationColorBlues } from '~/common/util/animUtils';
import { useIsMobile } from '~/common/components/useMatchMedia';

import { DevNewsItem, newsFrontendTimestamp, NewsItems } from './news.data';


const NEWS_INITIAL_COUNT = 3;
const NEWS_LOAD_STEP = 2;

export const newsRoadmapCallout = null;

export function BuildInfoCard(props: { noMargin?: boolean }) {
  return (
    <Card variant='solid' color='neutral' invertedColors sx={props.noMargin ? undefined : { mb: 3 }}>
      <Typography level='title-md' sx={{ my: -1 }}>
        Development Build Information
      </Typography>
      <BuildInfoSheet />
    </Card>
  );
}

function BuildInfoSheet() {
  const backendBuild = React.useMemo(() => getBackendCapabilities().build, []);
  const frontendBuild = React.useMemo(() => Release.buildInfo('frontend'), []);
  return (
    <Sheet variant='soft' invertedColors sx={{
      fontSize: 'xs',
      color: 'text.secondary',
      backgroundColor: 'background.popup',
      borderRadius: 'sm',
      p: 1,
      mb: -1,
      mx: -1,
    }}>
      PL: <strong>{Release.TenantSlug}</strong> - package {backendBuild?.pkgVersion} ({Release.Monotonics.NewsVersion}).<br />
      Frontend: {frontendBuild.gitSha} - deployed {frontendBuild.timestamp ? <strong><TimeAgo date={frontendBuild.timestamp} /></strong> : 'unknown'}, and
      backend {backendBuild?.gitSha}{backendBuild?.timestamp === frontendBuild.timestamp ? '.' : backendBuild?.timestamp ? <TimeAgo date={backendBuild.timestamp} /> : 'unknown.'}<br />
      Ships with -modal/-model: {Object.entries(Release.TechLevels).map(([name, version], idx, arr) => <React.Fragment key={name}><strong>{name}</strong> v{version}{idx < arr.length - 1 ? ', ' : ''}</React.Fragment>)}.<br />
      Ships with intelligent functions: {Release.AiFunctions.map((name, idx, arr) => <React.Fragment key={name}><i>{name}</i>{idx < arr.length - 1 ? ', ' : ''}</React.Fragment>)}.
    </Sheet>
  );
}

function NewsCard(props: { newsItem: typeof NewsItems[number]; }) {
  const { newsItem } = props;
  return (
    <Card variant='plain' sx={{ mb: 3, minHeight: 32, gap: 1 }}>
      <CardContent>
        <Typography level='title-sm' component='div'>
          <b>{newsItem.versionCode}</b>{newsItem.versionName ? <> - {newsItem.versionName}</> : null}
        </Typography>
        {!!newsItem.versionDate && (
          <Typography level='body-sm' sx={{ color: 'text.tertiary', mt: 0.5 }}>
            <TimeAgo date={newsItem.versionDate} />
          </Typography>
        )}
        {!!newsItem.text && (
          <Typography level='body-sm' sx={{ mt: 1 }}>
            {newsItem.text}
          </Typography>
        )}
        {!!newsItem.items?.length && (
          <Box component='ul' sx={{ mt: 1, mb: 0, pl: 3 }}>
            {newsItem.items.filter(item => item.dev !== true).map((item, idx) => (
              <li key={idx}>
                <Typography component='div' sx={{ fontSize: 'sm' }}>
                  {item.text}
                </Typography>
              </li>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

export function AppNews() {
  const [lastNewsIdx, setLastNewsIdx] = React.useState<number>(NEWS_INITIAL_COUNT - 1);
  const isMobile = useIsMobile();

  const news = NewsItems.filter((_, idx) => idx <= lastNewsIdx);
  const firstNews = news[0] ?? null;
  const canExpand = news.length < NewsItems.length;

  return (
    <Box sx={{
      flexGrow: 1,
      overflowY: 'auto',
      display: 'flex',
      justifyContent: 'center',
      p: { xs: 3, md: 6 },
    }}>
      <Box sx={{
        my: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <Typography level='h1' sx={{ fontSize: '2.7rem', mb: 4 }}>
          Welcome to <Box component='span' sx={{ animation: `${animationColorBlues} 10s infinite`, zIndex: 1 }}>DesignMate</Box>
        </Typography>

        <Typography sx={{ mb: 2, textAlign: 'center', lineHeight: 'lg' }} level='title-sm'>
          DesignMate is running version {firstNews?.versionCode}<br />
          {!!newsFrontendTimestamp && <span style={{ opacity: 0.65 }}>Updated <TimeAgo date={newsFrontendTimestamp} /></span>}
        </Typography>

        <Box sx={{ mb: 5, display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            variant='solid'
            color='neutral'
            size='lg'
            component={Link}
            href={ROUTE_INDEX}
            noLinkStyle
            endDecorator={<ArrowForwardRoundedIcon />}
            sx={{ minWidth: 180 }}
          >
            Continue
          </Button>
        </Box>

        <Container disableGutters maxWidth='sm'>
          {Release.IsNodeDevBuild && <NewsCard newsItem={DevNewsItem} />}
          {news.map((newsItem, idx) => <NewsCard key={`news-${idx}`} newsItem={newsItem} />)}
          {!isMobile && <BuildInfoCard />}
          {canExpand && (
            <Button
              fullWidth
              variant='soft'
              color='neutral'
              onClick={() => setLastNewsIdx(index => index + NEWS_LOAD_STEP)}
              endDecorator={<ExpandMoreIcon />}
            >
              Previous Updates
            </Button>
          )}
        </Container>
      </Box>
    </Box>
  );
}
