# Agent Skills (Siamo.Indicador)

This project uses skills installed under `.opencode/skills/` for production-grade engineering workflows.

## Core Rules

- If a task matches a skill, invoke it with the `skill` tool before acting.
- Skills are located in `.opencode/skills/<skill-name>/SKILL.md`.
- Follow the skill workflow strictly; do not partially apply it.
- Never skip required steps such as spec, plan, or test when a skill demands them.

## Intent → Skill Mapping

Map the user's intent to the matching skill automatically:

- Feature / new functionality → `spec-driven-development`, then `incremental-implementation` and `test-driven-development`
- Planning / breakdown → `planning-and-task-breakdown`
- Bug / failure / unexpected behavior → `debugging-and-error-recovery`
- Code review → `code-review-and-quality`
- Refactoring / simplification → `code-simplification`
- API or interface design → `api-and-interface-design`
- UI work → `frontend-ui-engineering`
- Security concerns → `security-and-hardening`
- Performance issues → `performance-optimization`
- Testing → `test-driven-development`
- Git workflow → `git-workflow-and-versioning`

## Execution Model

For every request:

1. Determine if any skill applies (even a small chance).
2. Load the skill with `skill({ name: "<skill-name>" })`.
3. Follow the skill workflow exactly.
4. Only proceed to implementation once required steps are complete.

## Project Context

- **Framework**: Next.js 14.2 with TypeScript
- **Styling**: Custom CSS (no Tailwind) with `.trazo` theme system
- **Backend**: Firebase (Auth + Firestore + Storage)
- **Architecture**: App Router with Server Components and Client Components
- **Roles**: Super Admin, Admin, Armador
- **Features**: QR scanning, time tracking, SAP Excel import, interactive maps, reports
