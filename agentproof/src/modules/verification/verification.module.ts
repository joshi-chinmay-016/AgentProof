/**
 * AgentProof MCP Layer — Verification Module
 * 
 * NitroStack module registering AgentProof MCP controllers and tools.
 */

import { Module } from '@nitrostack/core';
import { VerificationTools } from './verification.tools.js';

@Module({
  name: 'verification',
  description: 'Deterministic AI Agent Verification and Simulation Harness',
  controllers: [VerificationTools],
})
export class VerificationModule {}
