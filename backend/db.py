from neo4j import GraphDatabase
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "bodhi123"

    class Config:
        env_file = ".env"


settings = Settings()

driver = GraphDatabase.driver(
    settings.neo4j_uri,
    auth=(settings.neo4j_user, settings.neo4j_password),
)


def get_session():
    with driver.session() as session:
        yield session


def close_driver():
    driver.close()
