# Skill: Clean Architecture with Feature-Based Structure

## Overview

This skill defines the architecture standards for all projects. We use **Clean Architecture** combined with **Feature-Based** folder organization.

## Core Principles

1. **All code and comments in English** - Always
2. **Feature-based organization** - Group by feature, not by type
3. **Clean Architecture layers**:
   - Domain (entities, interfaces)
   - Application (use cases, services)
   - Infrastructure (external services, repositories)
   - Presentation (controllers, views)

## Folder Structure

```
src/
├── features/
│   ├── auth/
│   │   ├── domain/
│   │   │   ├── entities/
│   │   │   └── interfaces/
│   │   ├── application/
│   │   │   ├── useCases/
│   │   │   └── services/
│   │   ├── infrastructure/
│   │   │   ├── repositories/
│   │   │   └── services/
│   │   └── presentation/
│   │       ├── controllers/
│   │       └── routes/
│   ├── users/
│   └── [other features]/
├── shared/
│   ├── constants/
│   ├── utils/
│   └── types/
└── config/
```

## Naming Conventions

- **Files**: kebab-case (e.g., `user-service.ts`)
- **Classes**: PascalCase (e.g., `UserService`)
- **Functions**: camelCase (e.g., `getUserById`)
- **Constants**: UPPER_SNAKE_CASE
- **Interfaces**: PascalCase with `I` prefix (e.g., `IUserRepository`)

## Clean Architecture Rules

### Domain Layer
- Pure business logic
- No external dependencies
- Contains entities and interfaces

### Application Layer
- Use cases orchestrate domain
- Services for business rules
- No framework-specific code

### Infrastructure Layer
- External implementations
- Database, API clients
- Framework-specific code

### Presentation Layer
- HTTP handlers
- Views/UI components
- Input/Output adapters

## Example: Feature Auth

```typescript
// features/auth/domain/entities/user.entity.ts
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

// features/auth/domain/interfaces/user-repository.interface.ts
interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<User>;
}

// features/auth/application/use-cases/register-user.use-case.ts
class RegisterUserUseCase {
  constructor(private userRepo: IUserRepository) {}
  
  async execute(input: RegisterUserInput): Promise<User> {
    // business logic here
  }
}
```

## Notes

- Each feature should be self-contained
- Dependencies point inward (presentation -> application -> domain)
- Use dependency injection
- Keep business logic in domain/application layers
