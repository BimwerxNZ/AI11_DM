import * as React from 'react';

import { navigateToIndex } from '../src/common/app.routes';
import { withNextJSPerPageLayout } from '~/common/layout/withLayout';


export default withNextJSPerPageLayout({ type: 'optima', suspendAutoModelsSetup: true }, function DesignMateNewsDisabledPage() {
  React.useEffect(() => {
    void navigateToIndex(true);
  }, []);

  return null;
});
