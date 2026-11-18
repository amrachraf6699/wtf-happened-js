import type { Config } from './types.js';
export const ROOTS = [
  'packages/@*/*',
  'packages/*',
  'apps/*',
  'services/*',
  'modules/*',
  'src/modules/*',
  'src/features/*',
  'src/domain/*',
  'src/domains/*',
  'domain/*',
  'domains/*',
];
export function validPattern(p: unknown): p is string {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length <= 256 &&
    !/(?:^\/|\.\.|\\|:|[\x00-\x1f])/.test(p)
  );
}
export function glob(p: string): string {
  return p
    .split(/(\*\*|\*|\?)/)
    .map((s) =>
      s === '**'
        ? '.*'
        : s === '*'
          ? '[^/]*'
          : s === '?'
            ? '[^/]'
            : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
}
const reviewCategories = new Set([
  'Migrations',
  'Schemas',
  'Routes',
  'Authentication',
  'Policies',
  'Guards',
  'Middleware',
  'Configuration',
  'Dependencies',
  'Module Definitions',
  'Providers',
  'Infrastructure',
]);
const roles: Record<string, string> = {
  controller: 'Controllers',
  handler: 'Handlers',
  middleware: 'Middleware',
  service: 'Services',
  model: 'Models',
  entity: 'Models',
  repository: 'Repositories',
  validation: 'Validation',
  validator: 'Validation',
  auth: 'Authentication',
  authentication: 'Authentication',
  authorization: 'Authentication',
  policy: 'Policies',
  guard: 'Guards',
  job: 'Jobs',
  queue: 'Jobs',
  event: 'Events',
  listener: 'Listeners',
  command: 'Commands',
  provider: 'Providers',
  util: 'Utilities',
  utility: 'Utilities',
  helper: 'Utilities',
  type: 'Types',
  interface: 'Types',
  dto: 'DTOs',
  enum: 'Enums',
  exception: 'Exceptions',
  module: 'Module Definitions',
  interceptor: 'Interceptors',
  pipe: 'Pipes',
  filter: 'Filters',
  resolver: 'GraphQL',
  component: 'Components',
  hook: 'Hooks',
  composable: 'Hooks',
  store: 'State',
  state: 'State',
  directive: 'Directives',
  migration: 'Migrations',
  schema: 'Schemas',
  seed: 'Seeders',
  seeder: 'Seeders',
  route: 'Routes',
  action: 'Actions',
};
export function classify(path: string, config: Config['analysis']) {
  let module: string | null = null;
  for (const root of config.module_roots) {
    const m = new RegExp(`^(${glob(root)})/.+$`, 'i').exec(path);
    if (m) {
      module = m[1]!;
      break;
    }
  }
  const source =
    module !== null ||
    /^(?:src|app|pages|routes|server|lib|components|composables|hooks|database|prisma|drizzle|test|tests)\//i.test(
      path,
    );
  for (const rule of config.category_rules)
    if (new RegExp(`^${glob(rule.pattern)}$`, 'i').test(path))
      return {
        category: rule.category,
        module,
        source,
        review: rule.review ?? false,
      };
  const p = path.toLowerCase();
  const file = p.split('/').at(-1)!;
  let category = 'Other';
  if (/(?:^|\/)(?:node_modules|vendor|dist|build|generated|coverage)\//.test(p))
    category = 'Other';
  else if (/(?:^|\/)(?:docs?|documentation)\/|\.(?:md|mdx|rst|txt)$/.test(p))
    category = 'Documentation';
  else if (
    /(?:^|\/)(?:__tests__|__fixtures__|tests?|specs?|fixtures)\/|\.(?:test|spec)\.[^.]+$/.test(
      p,
    )
  )
    category = 'Tests';
  else if (
    /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(
      file,
    )
  )
    category = 'Dependencies';
  else if (
    /(?:^|\/)(?:\.github\/workflows|\.gitlab|terraform|k8s|kubernetes|deployment|deploy|infrastructure)\/|(?:^|\/)(?:dockerfile|compose\.ya?ml|docker-compose[^/]*|\.gitlab-ci\.yml)$|\.tf$/.test(
      p,
    )
  )
    category = 'Infrastructure';
  else if (
    /(?:^|\/)(?:config|configuration)\/|(?:^|[.])(?:config|rc)\.|^(?:\.[^.]+rc|tsconfig[^/]*|nx\.json|turbo\.json|pnpm-workspace\.yaml|\.env.*)$/.test(
      file,
    )
  )
    category = 'Configuration';
  else if (/\.(?:graphql|gql)$/.test(p)) category = 'GraphQL';
  else if (
    /\.(?:css|scss|sass|less|png|jpg|jpeg|svg|webp|ico|woff2?)$|(?:^|\/)(?:assets|public|styles)\//.test(
      p,
    )
  )
    category = 'Assets and Styles';
  else if (/(?:^|\/)(?:translations|locales|i18n|lang)\//.test(p))
    category = 'Translations';
  else if (/(?:^|\/)(?:migrations)\//.test(p)) category = 'Migrations';
  else if (
    file === 'schema.prisma' ||
    /(?:^|\/)(?:prisma|drizzle)\/.*schema/.test(p)
  )
    category = 'Schemas';
  else if (source && /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(p)) {
    if (
      /(?:^|\/)pages\/api\/|(?:^|\/)app\/.*\/route\.[^.]+$|(?:^|\/)routes\/.*\+server\.[^.]+$/.test(
        p,
      )
    )
      category = 'Routes';
    else if (
      /(?:^|\/)(?:pages|views)\/|(?:^|\/)(?:page|layout|loading|error|not-found|template|default|\+page|\+layout|\+error)(?:\.server)?\.[^.]+$/.test(
        p,
      )
    )
      category = 'Pages and Layouts';
    else {
      const suffix = /\.([a-z]+)\.[^.]+$/.exec(file)?.[1];
      if (suffix && roles[suffix]) category = roles[suffix]!;
      if (category === 'Other')
        for (const segment of p.split('/').slice(0, -1).reverse()) {
          const role =
            roles[segment] ??
            roles[segment.replace(/ies$/, 'y').replace(/s$/, '')];
          if (role) {
            category = role;
            break;
          }
        }
      if (category === 'Other' && /\.(?:vue|svelte|jsx|tsx)$/.test(file))
        category = 'Components';
      if (category === 'Other' && /^use[A-Z]/.test(path.split('/').at(-1)!))
        category = 'Hooks';
    }
  }
  const review =
    reviewCategories.has(category) ||
    (source &&
      category !== 'Tests' &&
      /^(?:auth|login|payment|checkout|webhook|billing|stripe|paypal)(?:[._-]|[A-Z])/.test(
        path.split('/').at(-1)!,
      ));
  return { category, module, source, review };
}
