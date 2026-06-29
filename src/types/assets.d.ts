// Module declarations for CSS imports used by the Expo template. Metro handles these at
// build time; this keeps the TypeScript check clean without the generated expo-env.d.ts.

declare module '*.css';

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
