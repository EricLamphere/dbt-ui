import multiprocessing


def main() -> None:
    import uvicorn

    from app.config import settings
    from app.main import app

    # Pass the app object directly rather than the "app.main:app" import string —
    # PyInstaller's frozen bundle can't re-resolve that string via uvicorn's own
    # module loader the way a normal installed package can.
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    # Required before anything else on a frozen (PyInstaller) executable: on
    # macOS/Windows, ProcessPoolExecutor (used by column lineage scanning) spawns
    # children by re-executing this same binary. freeze_support() intercepts that
    # re-execution before it reaches the app imports below, which would otherwise
    # re-run main() and fork indefinitely.
    multiprocessing.freeze_support()
    main()
