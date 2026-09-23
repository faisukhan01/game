# VOIDSTRIKE leaderboard — Spring Boot service.
# Stage 1 builds the fat jar with Maven; stage 2 ships a minimal JRE runtime.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app
RUN addgroup -g 1001 -S striker && adduser -u 1001 -G striker -S striker
COPY --from=build /src/target/leaderboard-service-1.0.0.jar app.jar
USER striker
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
