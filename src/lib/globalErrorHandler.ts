/**
 * Global Error Handler
 * Captures and logs all application errors to the system_error_logs table
 */

import { supabase } from '@/integrations/supabase/client';
import { 
  getCorrelationId, 
  getSessionId, 
  getDeviceInfo 
} from '@/services/correlationIdService';

interface ErrorContext {
  module?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  request_payload?: Record<string, any>;
  user_id?: string;
  user_name?: string;
}

/**
 * Log an error to the system_error_logs table
 * This function is designed to never throw - it catches its own errors
 */
export async function logApplicationError(
  error: Error | unknown,
  context: ErrorContext = {}
): Promise<void> {
  try {
    const errorObj = error instanceof Error
      ? error
      : new Error(
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as any).message)
            : String(error)
        );
    const errorMessage = errorObj.message || 'Unknown error occurred';
    const stackTrace = errorObj.stack || '';
    
    // Determine error type and severity
    const { errorType, severity } = categorizeError(errorMessage, stackTrace);
    
    // Get current user if available
    let userId = context.user_id;
    if (!userId) {
      try {
        // Local session only — a failing auth-server call during error
        // logging must never clear the user's session.
        const { data: { session } } = await supabase.auth.getSession();
        userId = session?.user?.id;
      } catch {
        // Ignore auth errors during error logging
      }
    }
    
    // Build log entry
    const logEntry = {
      correlation_id: getCorrelationId(),
      session_id: getSessionId(),
      user_id: userId,
      device_info: getDeviceInfo(),
      timestamp: new Date().toISOString(),
      severity,
      error_type: errorType,
      error_message: errorMessage,
      stack_trace: stackTrace,
      module: context.module || extractModuleFromStack(stackTrace),
      entity_type: context.entity_type,
      entity_id: context.entity_id,
      api_name: context.action,
      payload_json: context.request_payload ? sanitizePayload(context.request_payload) : null,
    };
    
    // Insert into error logs
    const { error: insertError } = await supabase
      .from('system_error_logs')
      .insert(logEntry);
    
    if (insertError) {
      console.error('Failed to log error to database:', insertError);
    }
  } catch (loggingError) {
    // Never throw from the error handler itself
    console.error('Error in global error handler:', loggingError);
  }
}

/**
 * Categorize error based on message and stack
 */
function categorizeError(message: string, stack: string): { errorType: string; severity: 'info' | 'warning' | 'error' | 'critical' } {
  const lowerMessage = message.toLowerCase();
  
  // Database/Supabase errors
  if (lowerMessage.includes('invalid input value for enum') || 
      lowerMessage.includes('violates') ||
      lowerMessage.includes('constraint')) {
    return { errorType: 'DATABASE_CONSTRAINT_ERROR', severity: 'error' };
  }
  
  if (lowerMessage.includes('unique_violation') || lowerMessage.includes('23505')) {
    return { errorType: 'DATABASE_DUPLICATE_ERROR', severity: 'error' };
  }
  
  if (lowerMessage.includes('foreign key') || lowerMessage.includes('23503')) {
    return { errorType: 'DATABASE_FK_ERROR', severity: 'error' };
  }
  
  if (lowerMessage.includes('permission denied') || lowerMessage.includes('rls')) {
    return { errorType: 'PERMISSION_ERROR', severity: 'error' };
  }
  
  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch') || lowerMessage.includes('timeout')) {
    return { errorType: 'NETWORK_ERROR', severity: 'warning' };
  }
  
  // Validation errors
  if (lowerMessage.includes('validation') || lowerMessage.includes('required') || lowerMessage.includes('invalid')) {
    return { errorType: 'VALIDATION_ERROR', severity: 'warning' };
  }
  
  // Authentication errors
  if (lowerMessage.includes('auth') || lowerMessage.includes('token') || lowerMessage.includes('session')) {
    return { errorType: 'AUTH_ERROR', severity: 'error' };
  }
  
  // Workflow errors
  if (stack.includes('workflow') || lowerMessage.includes('workflow')) {
    return { errorType: 'WORKFLOW_ERROR', severity: 'error' };
  }
  
  // API/Integration errors
  if (lowerMessage.includes('api') || lowerMessage.includes('integration') || lowerMessage.includes('external')) {
    return { errorType: 'INTEGRATION_ERROR', severity: 'error' };
  }
  
  // Critical errors
  if (lowerMessage.includes('critical') || lowerMessage.includes('fatal') || lowerMessage.includes('crash')) {
    return { errorType: 'CRITICAL_ERROR', severity: 'critical' };
  }
  
  // Default
  return { errorType: 'APPLICATION_ERROR', severity: 'error' };
}

/**
 * Extract module name from stack trace
 */
function extractModuleFromStack(stack: string): string | undefined {
  // Try to extract from common path patterns
  const patterns = [
    /src\/pages\/([^\/]+)/,
    /src\/components\/([^\/]+)/,
    /src\/hooks\/([^\/]+)/,
    /src\/services\/([^\/]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = stack.match(pattern);
    if (match) {
      return match[1].replace(/\.(tsx?|jsx?)$/, '');
    }
  }
  
  return undefined;
}

/**
 * Sanitize payload to remove sensitive data before logging
 */
function sanitizePayload(payload: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'apikey', 'authorization', 'auth'];
  const sanitized = { ...payload };
  
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizePayload(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Create a wrapped mutation error handler that logs errors
 */
export function createMutationErrorHandler(context: ErrorContext) {
  return async (error: Error) => {
    await logApplicationError(error, context);
  };
}

/**
 * Setup global window error handlers
 */
export function setupGlobalErrorHandlers(): void {
  // Handle uncaught errors
  window.onerror = (message, source, lineno, colno, error) => {
    logApplicationError(error || new Error(String(message)), {
      module: 'GLOBAL_ERROR_HANDLER',
      action: 'uncaught_error',
    });
    return false; // Let the error propagate
  };
  
  // Handle unhandled promise rejections
  window.onunhandledrejection = (event) => {
    logApplicationError(event.reason, {
      module: 'GLOBAL_ERROR_HANDLER',
      action: 'unhandled_promise_rejection',
    });
  };
}
