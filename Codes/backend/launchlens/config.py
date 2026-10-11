"""Typed settings, read from the process environment and the project .env.

Secrets live only here, server-side. Several provider keys exist in the owner's
.env under legacy names; `AliasChoices` reads the canonical name first and the
legacy alias only when the canonical one is absent, so nothing has to be copied.
"""
from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CODES_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = CODES_DIR / "backend"


def _alias(*names: str) -> AliasChoices:
    return AliasChoices(*names)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # .env holds keys; .env.production (optional, later wins) holds deployment overrides.
        env_file=(str(CODES_DIR / ".env"), str(CODES_DIR / ".env.production")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # Runtime identity
    APP_ENV: str = "development"
    APP_NAME: str = "LaunchLens"
    APP_BASE_URL: str = "http://127.0.0.1:8140"
    FRONTEND_ORIGIN: str = "http://127.0.0.1:5173"
    CORS_ALLOWED_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"
    LOG_LEVEL: str = "INFO"
    REQUEST_TIMEOUT_SECONDS: float = 60.0

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://launchlens_app@127.0.0.1:5432/launchlens"
    LANGGRAPH_DATABASE_URL: str = ""
    LANGGRAPH_SCHEMA: str = "langgraph"

    # Auth
    AUTH_SECRET: str = ""
    SESSION_COOKIE_SECURE: bool = False
    SESSION_TTL_HOURS: int = 72
    SEED_USER: str = "TestUser"
    SEED_PASSWORD: str = "TestUser11"

    # Demo isolation
    DEMO_MODE: bool = True
    DEMO_GENERATION_ENABLED: bool = True
    DEMO_DAILY_COST_USD: Decimal = Decimal("5.00")

    # Qloo
    QLOO_API_KEY: str = Field(default="", validation_alias=_alias("QLOO_API_KEY", "QLOO_2009_API_KEY", "Qloo_API_KEY", "QLOO_KEY"))
    QLOO_BASE_URL: str = Field(default="https://hackathon.api.qloo.com",
                               validation_alias=_alias("QLOO_BASE_URL", "Qloo_Hackathon_API_Server_URL"))
    QLOO_REQUEST_TIMEOUT_SECONDS: float = 30.0
    QLOO_CACHE_TTL_SECONDS: int = 86_400

    # Reasoning: OpenAI is required; OpenRouter is an optional, explicit fallback.
    OPENAI_API_KEY: str = Field(default="", validation_alias=_alias("OPENAI_API_KEY", "Open_AI_2009_Key"))
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4.1-mini"
    OPENROUTER_API_KEY: str = Field(default="", validation_alias=_alias("OPENROUTER_API_KEY", "OPENROUTER_API_KEY_1"))
    OPENROUTER_BASE_URL: str = Field(default="https://openrouter.ai/api/v1",
                                     validation_alias=_alias("OPENROUTER_BASE_URL", "OPENROUTER_API_BASE_URL"))
    OPENROUTER_MODEL: str = "openai/gpt-4.1-mini"
    # second OpenRouter account, used after the first in both the reasoning and image fallback chains
    OPENROUTER_FALLBACK_API_KEY: str = Field(default="", validation_alias=_alias("OPENROUTER_FALLBACK_API_KEY", "OPENROUTER_API_KEY_2"))
    OPENROUTER_IMAGE_MODEL: str = "google/gemini-2.5-flash-image"
    # reasoning fallbacks after NanoGPT's two keys, in order (LLM_FALLBACK_PROVIDER is appended last)
    LLM_FALLBACK_CHAIN: str = "openrouter,openrouter_2"
    OPENROUTER_PROVIDER_ALLOWLIST: str = ""
    OPENROUTER_DATA_POLICY: str = "deny"
    LLM_PRIMARY_PROVIDER: str = "nanogpt"  # owner's choice 2026-10-11: OpenAI and xAI accounts had no credits
    LLM_FALLBACK_PROVIDER: str = "openrouter"
    LLM_ALLOW_FALLBACK: bool = False

    # xAI / Grok media
    XAI_API_KEY: str = Field(default="", validation_alias=_alias("XAI_API_KEY", "GROK_API_KEY", "Grok_API_KEY"))
    XAI_BASE_URL: str = "https://api.x.ai/v1"
    XAI_TEXT_MODEL: str = "grok-4.20-0309-non-reasoning"   # reasoning fallback (LLM_FALLBACK_PROVIDER=xai)
    XAI_IMAGE_MODEL: str = "grok-imagine-image"
    XAI_VIDEO_MODEL: str = "grok-imagine-video"
    XAI_VIDEO_RESOLUTION: str = "720p"
    # Image and video generation go through NanoGPT (same Grok Imagine models) with a primary
    # and a fallback key; direct xAI is the last resort only when MEDIA_XAI_FALLBACK is true.
    MEDIA_PROVIDER: str = "nanogpt"  # nanogpt | xai
    NANOGPT_API_KEY: str = Field(default="", validation_alias=_alias("NANOGPT_API_KEY", "NanoGPT_88_API_Key"))
    NANOGPT_FALLBACK_API_KEY: str = Field(default="", validation_alias=_alias(
        "NANOGPT_FALLBACK_API_KEY", "NanoGPT_2009_API_KEY", "Nano_GPT_API_KEY"))
    NANOGPT_BASE_URL: str = "https://nano-gpt.com/api"
    NANOGPT_IMAGE_MODEL: str = "grok-imagine-image"
    NANOGPT_VIDEO_MODEL: str = "grok-imagine-video"
    NANOGPT_TEXT_MODEL: str = "openai/gpt-4.1-mini"  # reasoning via NanoGPT (strict JSON output verified)
    MEDIA_XAI_FALLBACK: bool = True  # legacy flag (the chains below decide now)
    # generation order, first configured provider first (owner's choice 2026-10-11: xAI recharged)
    MEDIA_IMAGE_CHAIN: str = "xai,nanogpt,openrouter"
    MEDIA_VIDEO_CHAIN: str = "xai,nanogpt"
    XAI_POLL_INTERVAL_SECONDS: float = 5.0
    XAI_JOB_TIMEOUT_SECONDS: float = 900.0

    # Narration (optional): Fish Audio leads for hi/bn, fal (ElevenLabs) for en.
    TTS_PROVIDER: str = "auto"
    TTS_API_KEY: str = Field(default="", validation_alias=_alias("TTS_API_KEY", "FISH_AUDIO_API_KEY", "Fish_Audio_88_API_KEY"))
    TTS_MODEL: str = Field(default="s2.1-pro", validation_alias=_alias("TTS_MODEL", "FISH_AUDIO_MODEL"))
    FISH_AUDIO_BASE_URL: str = "https://api.fish.audio"
    FISH_AUDIO_VOICE_ID: str = ""
    FISH_AUDIO_VOICE_POOL: str = ""
    FAL_KEY: str = Field(default="", validation_alias=_alias("FAL_KEY", "FAL_AI_88_Admin_API_KEY"))
    FAL_QUEUE_URL: str = "https://queue.fal.run"
    FAL_TTS_MODEL: str = "fal-ai/elevenlabs/tts/turbo-v2.5"

    # Sarvam AI: preferred for Hindi/Bengali translation and narration.
    SARVAM_API_KEY: str = Field(default="", validation_alias=_alias(
        "SARVAM_API_KEY", "SARVAM_2009_API_KEY", "SARVAM_88_API_KEY", "SARVAM_PHD_API_KEY"))
    SARVAM_BASE_URL: str = "https://api.sarvam.ai"
    SARVAM_TRANSLATE_MODEL: str = "mayura:v1"
    SARVAM_TTS_MODEL: str = "bulbul:v3"
    SARVAM_SPEAKER_BN: str = "priya"
    SARVAM_SPEAKER_HI: str = "kavya"
    SARVAM_SPEAKER_EN: str = "shubh"

    # Geography and practical data
    GEOCODING_PROVIDER: str = "nominatim"
    GEOCODING_BASE_URL: str = "https://nominatim.openstreetmap.org"
    GEOCODING_API_KEY: str = ""
    GEOCODING_CONTACT_EMAIL: str = ""
    MAP_STYLE_URL: str = "https://tiles.openfreemap.org/styles/positron"
    MAP_PUBLIC_TOKEN: str = ""
    PLACES_PROVIDER: str = "overpass"
    PLACES_BASE_URL: str = "https://overpass-api.de/api/interpreter"
    PLACES_API_KEY: str = ""
    WEATHER_PROVIDER: str = "open-meteo"
    WEATHER_BASE_URL: str = "https://archive-api.open-meteo.com/v1/archive"
    WEATHER_API_KEY: str = ""

    # Storage
    STORAGE_BACKEND: str = "local"
    LOCAL_ASSET_DIR: str = str(CODES_DIR / "data" / "assets")
    S3_ENDPOINT_URL: str = ""
    S3_BUCKET: str = ""
    S3_REGION: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""

    # Media tools
    FFMPEG_PATH: str = "ffmpeg"
    FFPROBE_PATH: str = "ffprobe"
    FONT_ASSET_DIR: str = str(CODES_DIR / "assets" / "fonts")

    # Bounded execution
    WORKER_CONCURRENCY: int = 3
    MAX_PROVIDER_CONCURRENCY: int = 4
    QLOO_MAX_CONCURRENCY: int = 6
    LLM_MAX_CONCURRENCY: int = 3   # strategies and briefs written in parallel
    JOB_LEASE_SECONDS: int = 120
    MAX_AGENT_STEPS: int = 60
    MAX_RESEARCH_CALLS: int = 80
    MAX_GENERATION_ATTEMPTS: int = 2
    MAX_UPLOAD_MB: int = 25
    MAX_VIDEO_SECONDS: int = 20
    MAX_ASSETS_PER_BATCH: int = 12
    MAX_CANDIDATE_LOCATIONS: int = 5
    MAX_RUN_COST_USD: Decimal = Decimal("3.00")
    MAX_DAILY_COST_USD: Decimal = Decimal("10.00")
    PROVIDER_PRICING_FILE: str = str(CODES_DIR / "deploy" / "provider-pricing.json")

    @field_validator("AUTH_SECRET")
    @classmethod
    def _secret_len(cls, v: str) -> str:
        if v and len(v) < 32:
            raise ValueError("AUTH_SECRET must be at least 32 characters")
        return v

    # ---- derived -------------------------------------------------------------
    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def sync_database_url(self) -> str:
        """psycopg3 URL for LangGraph's checkpointer (it does not use asyncpg)."""
        url = self.LANGGRAPH_DATABASE_URL or self.DATABASE_URL
        return url.replace("postgresql+asyncpg://", "postgresql://").replace("postgresql+psycopg://", "postgresql://")

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    def public_config(self) -> dict:
        """The only settings the browser may see. Explicit allowlist."""
        return {
            "appName": self.APP_NAME,
            "mapStyleUrl": self.MAP_STYLE_URL,
            "mapPublicToken": self.MAP_PUBLIC_TOKEN,
            "demoMode": self.DEMO_MODE,
            "maxUploadMb": self.MAX_UPLOAD_MB,
            "languages": ["en", "hi", "bn", "es"],
        }

    def secret_values(self) -> list[str]:
        """Every configured secret, for redaction. Never logged or returned."""
        vals = [self.QLOO_API_KEY, self.OPENAI_API_KEY, self.OPENROUTER_API_KEY, self.XAI_API_KEY,
                self.NANOGPT_API_KEY, self.NANOGPT_FALLBACK_API_KEY, self.OPENROUTER_FALLBACK_API_KEY,
                self.TTS_API_KEY, self.FAL_KEY, self.SARVAM_API_KEY, self.GEOCODING_API_KEY, self.PLACES_API_KEY,
                self.WEATHER_API_KEY, self.S3_SECRET_ACCESS_KEY, self.S3_ACCESS_KEY_ID, self.AUTH_SECRET]
        db_pw = _db_password(self.DATABASE_URL)
        if db_pw:
            vals.append(db_pw)
        return [v for v in vals if v and len(v) >= 6]


def _db_password(url: str) -> str:
    try:
        creds = url.split("://", 1)[1].split("@", 1)[0]
        return creds.split(":", 1)[1] if ":" in creds else ""
    except IndexError:
        return ""


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    if not s.AUTH_SECRET:
        raise RuntimeError("AUTH_SECRET is not set. Add a random value of 32+ characters to .env")
    return s


settings = get_settings()
