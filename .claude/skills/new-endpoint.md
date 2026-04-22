---
name: new-endpoint
description: Scaffold a new FastAPI endpoint for dbt-ui — creates the router function, Pydantic DTOs, migration (if needed), and api.ts typed helper following project conventions.
---

<command-instructions>
You are scaffolding a new FastAPI endpoint in the dbt-ui project. Follow these steps precisely.

## Parse the Arguments

The user invoked this skill with args describing the endpoint. Extract:
- **Resource**: what entity is being operated on (e.g. "profile", "model", "run")
- **Method**: HTTP method (GET, POST, PUT, PATCH, DELETE)
- **Path**: the URL path (e.g. `/{project_id}/profiles/{profile_id}/activate`)
- **Description**: what this endpoint does (may be implicit from the path)

If args are vague, ask one clarifying question before proceeding.

## Step 1: Identify the Router File

Find the right `backend/app/api/*.py` file for this resource. Common mappings:
- Projects → `projects.py`
- Models/graph → `models.py`
- Env profiles/vars → `env.py`
- Init pipeline/steps → `init.py`
- Files/SQL → `files.py`
- Docs → `docs.py`
- Global profiles → `global_profiles.py`
- Terminal → `terminal.py`
- Settings → `settings.py`

Read the existing file before appending to it.

## Step 2: Write the Pydantic DTOs

Follow naming conventions:
- Request body: `{Action}{Resource}Dto` (e.g. `CreateProfileDto`, `RenameStepDto`)
- Response: `{Resource}Dto` or `{Resource}Out` (e.g. `ProfileDto`, `ProjectOut`)

Always use `BaseModel` from pydantic. Optional fields use `field: type | None = None`.

## Step 3: Write the Router Function

Follow this exact pattern:

```python
@router.{method}("/{path}", response_model={ResponseDto}, status_code={200_or_201_or_204})
async def {function_name}(
    project_id: int,                              # path params first
    profile_id: int,                              # ...
    dto: {RequestDto},                            # body (POST/PUT/PATCH only)
    session: AsyncSession = Depends(get_session), # always last
) -> {ResponseDto}:
    # 1. Fetch the parent resource and 404 if missing
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    # 2. Fetch the specific resource and 404 if missing
    resource = await session.get(MyResource, resource_id)
    if resource is None or resource.project_id != project_id:
        raise HTTPException(status_code=404, detail="resource not found")

    # 3. Business logic
    ...

    # 4. Commit and return DTO
    await session.commit()
    return _resource_to_dto(resource)
```

Key rules:
- Always check parent ownership (`resource.project_id != project_id`)
- Use `selectinload` when the response DTO includes child relationships
- 201 for POST (creation), 204 for DELETE (no body), 200 for everything else
- DELETE endpoints return `None` with `status_code=204`

## Step 4: Add Migration (if new table needed)

If this endpoint requires a new DB table or column, append to `backend/app/db/migrations.py` inside `run_migrations()`:

```python
if not await _table_exists(session, "new_table"):
    await session.execute(text("CREATE TABLE new_table (...)"))
    await session.commit()
```

Also add the SQLAlchemy model to `backend/app/db/models.py`.

## Step 5: Add api.ts Typed Helper

Append to the appropriate namespace in `frontend/src/lib/api.ts`:

```typescript
// In the relevant namespace (profiles, models, etc.)
newAction: (projectId: number, resourceId: number) =>
  post<ResourceDto>(`/projects/${projectId}/resources/${resourceId}/action`),
```

For DELETE endpoints returning void:
```typescript
delete: (projectId: number, resourceId: number) =>
  request<void>(`/projects/${projectId}/resources/${resourceId}`, { method: 'DELETE' }),
```

## Step 6: Report

Summarize what was created:
- File(s) modified
- Endpoint path + method
- DTO names
- api.ts helper signature
- Any migrations added
</command-instructions>
