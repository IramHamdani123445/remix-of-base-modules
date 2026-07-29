/**
 * Omni-Comms — Architecture module barrel.
 */
export * from './architectureCheck.types';
export * from './architecturePolicy';
export * from './architectureBaseline';
export * from './runArchitectureChecks';

export { checkLegacyImports } from './checks/checkLegacyImports';
export { checkLegacyTableReferences } from './checks/checkLegacyTableReferences';
export { checkProviderImports } from './checks/checkProviderImports';
export { checkReactRuntimeWrites } from './checks/checkReactRuntimeWrites';
export { checkMigrationRegistry } from './checks/checkMigrationRegistry';
export { checkRouteRegistry } from './checks/checkRouteRegistry';
export { checkIntegrationRegistry } from './checks/checkIntegrationRegistry';
export { checkQueueRegistry } from './checks/checkQueueRegistry';
export { checkFacadeBoundary } from './checks/checkFacadeBoundary';
export { checkPermanentNames } from './checks/checkPermanentNames';
export { checkResolverBoundary } from './checks/checkResolverBoundary';
