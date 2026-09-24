FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app
RUN useradd -r -u 1001 striker
COPY target/leaderboard-service-1.0.0.jar app.jar
USER striker
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
