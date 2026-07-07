pipeline {
    agent any

    environment {
        IMAGE_NAME = 'ghcr.io/dulanprabashwara/easy-blogger-backend'
        IMAGE_TAG  = 'latest'
        CONTAINER_NAME = 'easy-blogger-backend'
    }

    stages {
        // ── CI: Build & Push ────────────────────────
        stage('Login to GHCR') {
            steps {
                withCredentials([string(credentialsId: 'ghcr-pat', variable: 'GH_TOKEN')]) {
                    sh 'echo $GH_TOKEN | docker login ghcr.io -u dulanprabashwara --password-stdin'
                }
            }
        }

        stage('Build Image') {
            steps {
                sh "docker build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
            }
        }

        stage('Push Image') {
            steps {
                sh "docker push ${IMAGE_NAME}:${IMAGE_TAG}"
            }
        }

        // ── CD: Pull & Deploy ───────────────────────
        stage('Deploy') {
            steps {
                sh """
                    docker pull ${IMAGE_NAME}:${IMAGE_TAG}
                    docker stop ${CONTAINER_NAME} || true
                    docker rm ${CONTAINER_NAME} || true
                    docker run -d \
                        --name ${CONTAINER_NAME} \
                        --restart unless-stopped \
                        --env-file /opt/easy-blogger/backend.env \
                        -p 127.0.0.1:5000:5000 \
                        ${IMAGE_NAME}:${IMAGE_TAG}
                """
            }
        }
    }

    post {
        always {
            sh 'docker logout ghcr.io'
        }
        success {
            echo '✅ Backend deployed successfully!'
        }
        failure {
            echo '❌ Backend deployment failed.'
        }
    }
}
