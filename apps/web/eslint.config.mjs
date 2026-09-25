import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [...nextVitals, { ignores: ['.next/**', 'e2e/test-results/**', 'e2e/playwright-report/**'] }];
export default config;
