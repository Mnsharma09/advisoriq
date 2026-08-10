from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://advisoriq:advisoriq@localhost:5432/advisoriq"
    # Sync URL used only by the seed script
    database_url_sync: str = "postgresql://advisoriq:advisoriq@localhost:5432/advisoriq"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:4173",
    ]
    api_prefix: str = "/api/v1"


settings = Settings()
