# Callback Box: Design Vision and Architecture

Callback Box is a personal automation and content management system built on git as the coordination layer, with Claude Code as the development environment. The system is organized around several core concepts and interaction modes that work together coherently.

## Core Organizational Concepts

**Landmarks** are distinct activity centers within the file system—places where you go to do specific kinds of work. Unlike simple folder hierarchies, landmarks represent semantic boundaries. Five subdirectories that are variations on a single theme share one landmark. Truly different activities each get their own landmark. This is a navigation and organizational concept that shapes both file structure and user interface.

**Categories** form the triage stage for incoming items. Material arrives from multiple sources—document scans, voice inputs, external submissions—often with incomplete context. The categorization stage is the formal routing layer that decides where things belong. Critically, it must handle edge cases: items that don't fit existing categories go into a holding area pending clarification. This was historically ad hoc; the formal three-stage pipeline (intake → triage → handle) now implements it. See `docs/plans/triage-design.md`.

**Chat Instructions** extend triage beyond file routing. These are active extraction rules that guide what Claude should notice and capture during conversation. They're not about comprehensive memory or emotional tracking, but about intentional collection. If you want to keep a journal of interesting observations while driving, chat instructions say: watch for this, extract it here. Instructions can be explicit rules or pointers to where further logic lives. This is separate from the broader memory system but complements it.

## Interaction Modalities

The system supports multiple interaction modes that are composable and can be remixed:

**Narration Mode** is listening-focused interaction. Claude asks fewer questions, offers minimal chitchat, and lets you think out loud. This is the core mode for idea dumps, design work, and processing. It's driven by voice input using long-form transcription (Whisper, Foxtel) rather than streaming, which produces cleaner, more accurate transcripts.

**Factual Mode** surfaces when Claude has something concrete to address. If you ask a specific question mid-thought—"when was the Paris Commune?"—Claude answers directly without the usual conversational wrapper. This mode is complimentary to narration but can be invoked any time. It's the opposite of sycophancy: just the answer.

**Voice and Speech Controls** allow overriding and customizing how Claude communicates. Multiple voices can be used, instructions can change per interaction, and the user always has agency over how the AI speaks back.

## System Awareness and Context

Claude maintains rich awareness of user context and system state:

- It knows what document you're looking at, which parts you've highlighted, where you are in the interface
- It understands the UI and can query and modify it
- It has introspection capabilities for examining past chat sessions, even when they're paged out of memory
- Git history is kept rich with meaningful commit messages, allowing you to trace how ideas and files evolved
- This shared context makes Claude a genuine collaborator, not just a responder

## Extensibility Through Knowledge, Not Plugins

The system's extensibility model prioritizes understanding and knowledge over plugin architecture:

- Claude can build new types, interfaces, and views within the system using Claude Code
- The expectation is not that users assemble plugins, but that they learn concepts, best practices, and approaches to composition
- Research and investigation are encouraged—when you discover that re-encoding images to AVIF saves fifty percent, that knowledge becomes part of the system's understanding
- Command-line tools and frontends can be built and installed, but the primary extensibility mechanism is conceptual: giving Claude the knowledge to compose existing pieces in new ways
- Custom views and interactions can be built through careful prompting and structured approaches, not through elaborate plugin systems

## Design Philosophy: Intentionality and Composition

Every piece of the system should be well-thought-out and purposeful:

- Build new infrastructure only when basic building blocks don't solve the problem
- When you want something new—like prompted journaling—compose it from existing pieces (narration mode plus custom prompts) rather than building from scratch
- Small additions like a `CLAUDE.md` file with custom prompts are preferred to elaborate new structures
- Introduce new building blocks (like interactive widgets) when they unlock reusable capability across multiple features

The goal is familiarity and depth, not novelty. Users benefit from understanding narration mode deeply because it works consistently everywhere, whether journaling, brainstorming, or processing archived documents.

## The Operating System Vision

Callback Box functions as a personal operating system where Claude Code becomes the development environment. New features and applications are built *within* the system's constraints:

- State lives in git with structured file organization
- The file system and UI have established patterns and constraints
- Claude has complete code access but is expected to work within conventions intentionally, not out of constraint but out of understanding
- When Claude builds something unconventional, there's a deliberate reason—not because it doesn't know the standard way

This prevents the homogenization that happens when AI defaults to generic patterns. Instead, the system becomes *yours*: shaped by your thinking, your needs, your conventions.

## Taste and Vision

The system is built with taste—each piece carefully considered, focused on what it's trying to achieve rather than on building comprehensive infrastructure. The result should feel like your own space, not a collection of disconnected tools. It's a real system with coherent structure, but one where everything serves your specific way of working.
