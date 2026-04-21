// This file exists ONLY to satisfy the Sentry Next.js webpack plugin
// on App Router projects. Sentry's `withSentryConfig` expects a Pages
// Router error page so it can wire in `captureUnderscoreErrorException`.
// Without this stub, the build errors with `PageNotFoundError: Cannot
// find module for page: /_error`.
//
// App Router's real error handling lives in:
//   - src/app/error.tsx        (route-level errors)
//   - src/app/global-error.tsx (root errors)
//   - src/app/not-found.tsx    (404s)
//
// This page should never actually render in production because the App
// Router owns every route.

import * as Sentry from '@sentry/nextjs';
import Error from 'next/error';
import type { NextPage, NextPageContext } from 'next';

interface ErrorProps {
  statusCode: number;
}

const CustomErrorPage: NextPage<ErrorProps> = ({ statusCode }) => {
  return <Error statusCode={statusCode} />;
};

CustomErrorPage.getInitialProps = async (contextData: NextPageContext) => {
  await Sentry.captureUnderscoreErrorException(contextData);
  return { statusCode: contextData.res?.statusCode ?? 500 };
};

export default CustomErrorPage;
