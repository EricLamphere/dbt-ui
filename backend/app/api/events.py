from fastapi import APIRouter

from app.events.sse import sse_response

router = APIRouter()


@router.get("/api/events/global")
async def global_events():
    return sse_response("global")


@router.get("/api/projects/{project_id}/events")
async def project_events(project_id: int):
    return sse_response(f"project:{project_id}")
