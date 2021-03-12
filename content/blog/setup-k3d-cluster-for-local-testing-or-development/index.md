---
title: "Setup k3d Cluster for local Testing or Development"
date: 2021-03-10T17:36:13+05:30
tags: ["k3d", "docker", "kubernetes"]
draft: false
---

There are over [90 Certified Kubernetes](https://www.cncf.io/certification/software-conformance/) offerings as of this blog publication. One such project currently under Linux Foundation is [k3s](https://k3s.io/) and below quote is directly taken from it's landing page:
> K3s is a highly available, certified Kubernetes distribution designed for production workloads in unattended, resource-constrained, remote locations or inside IoT appliances.

Clubbing two words `resource-constrained` and `IoT` from the quote we can infer that this distribution is also best suited for setting up our local Kubernetes cluster. Going a step further and inspired by [KinD](https://kind.sigs.k8s.io/) project, [k3d](https://k3d.io/) is created which runs `k3s` Kubernetes distribution in docker and as a result `k3d` has a single dependency which is docker.

## Pre-requisites

Conceptual knowledge of docker and kubernetes to utilize `k3d` created cluster, you can refer below resources\*:
- Docker: [Video](https://youtu.be/3c-iBn73dDE), [Installation](https://docs.docker.com/engine/install/fedora/)
- Kubernetes: [Video](https://youtu.be/X48VuDVv0do) or [Book](https://www.amazon.in/dp/1492046531)

\**Non-affiliated, I referred all these resources atleast once and so recommending them*

Although docker is updated to work with cgroup v2, I was only able to setup `k3d` cluster on falling back to cgroup v1 using below method:
- To cgroup v1: `dnf install grubby && grubby --update-kernel=ALL --args="systemd.unified_cgroup_hierarchy=0" && reboot`
- To switch back to cgroup v2: `grubby --update-kernel=ALL --args="systemd.unified_cgroup_hierarchy" && reboot`

Fedora recommended option is to use [podman](https://podman.io/) and [buildah](https://buildah.io/) however the steps in this post tested using docker.

I used **Fedora 32 Server Edition** with **8Gi** of RAM, [`/var`](https://thoughtexpo.com/move-var-to-a-new-partition-in-vm/) parition mounted on a **100GB** (having free space on `/var` partition never hurts :smile:) disk, tested installation and subsequent operations as `root` (just having `sudo` access also suffices) user. YMMV may vary depending on how well-versed you are with your machine.

## Installing Binary

k3d version 4 is preferred as it has `k3d-managed` registry and it comes handy to create a repository along with cluster creation with no extra steps.
``` sh
# curl -OL https://github.com/rancher/k3d/releases/download/v4.2.0/k3d-linux-amd64
# chmod +x k3d-linux-amd64
# mv k3d-linux-amd64 /usr/local/bin/k3d
```

After downloading binary you can verify the verison and that's all it needs to create a cluster
``` sh
# k3d version
k3d version v4.2.0
k3s version v1.20.2-k3s1 (default)
```

## Cluster Operations

Let's go through lifecycle of a k3d cluster and later we can move on to customizing the cluster to our needs. Please refer [docs](https://k3d.io/usage/commands/) for command tree

``` sh {linenos=table,hl_lines=[15,19,29,35,42],linenostart=1}
# Create a cluster with One master (-s/--server) and Three worker (-a/--agent) nodes
# k3d cluster create test -s 1 -a 3
[...]

# k3d cluster list
NAME   SERVERS   AGENTS   LOADBALANCER
test   1/1       3/3      true

# k3d node list
NAME                ROLE           CLUSTER   STATUS
k3d-test-agent-0    agent          test      running
k3d-test-agent-1    agent          test      running
k3d-test-agent-2    agent          test      running
k3d-test-server-0   server         test      running
k3d-test-serverlb   loadbalancer   test      running

# docker ps -a
CONTAINER ID   IMAGE                      COMMAND                  CREATED        STATUS        PORTS                             NAMES
e2380067ded8   rancher/k3d-proxy:v4.2.0   "/bin/sh -c nginx-pr…"   21 hours ago   Up 21 hours   80/tcp, 0.0.0.0:38871->6443/tcp   k3d-test-serverlb
1a181b9a04b3   rancher/k3s:v1.20.2-k3s1   "/bin/k3s agent"         21 hours ago   Up 21 hours                                     k3d-test-agent-2
1df295350238   rancher/k3s:v1.20.2-k3s1   "/bin/k3s agent"         21 hours ago   Up 21 hours                                     k3d-test-agent-1
b2846655286c   rancher/k3s:v1.20.2-k3s1   "/bin/k3s agent"         21 hours ago   Up 21 hours                                     k3d-test-agent-0
3aae96cd4797   rancher/k3s:v1.20.2-k3s1   "/bin/k3s server --t…"   21 hours ago   Up 21 hours                                     k3d-test-server-0

# netstat -tlpn
Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      921/sshd: /usr/sbin
tcp        0      0 0.0.0.0:38871           0.0.0.0:*               LISTEN      2450824/docker-prox
tcp6       0      0 :::9090                 :::*                    LISTEN      1/systemd
tcp6       0      0 :::22                   :::*                    LISTEN      921/sshd: /usr/sbin

# kubectl get nodes -o wide
NAME                STATUS   ROLES                  AGE   VERSION        INTERNAL-IP   EXTERNAL-IP   OS-IMAGE   KERNEL-VERSION           CONTAINER-RUNTIME
k3d-test-agent-1    Ready    <none>                 20h   v1.20.2+k3s1   172.28.0.4    <none>        Unknown    5.9.16-100.fc32.x86_64   containerd://1.4.3-k3s1
k3d-test-agent-2    Ready    <none>                 20h   v1.20.2+k3s1   172.28.0.5    <none>        Unknown    5.9.16-100.fc32.x86_64   containerd://1.4.3-k3s1
k3d-test-agent-0    Ready    <none>                 20h   v1.20.2+k3s1   172.28.0.3    <none>        Unknown    5.9.16-100.fc32.x86_64   containerd://1.4.3-k3s1
k3d-test-server-0   Ready    control-plane,master   20h   v1.20.2+k3s1   172.28.0.2    <none>        Unknown    5.9.16-100.fc32.x86_64   containerd://1.4.3-k3s1

# docker exec k3d-test-server-0 sh -c 'ctr version'
Client:
  Version:  v1.4.3-k3s1
  Revision: 
  Go version: go1.15.5

Server:
  Version:  v1.4.3-k3s1
  Revision: 
  UUID: 2d6b816f-3d50-408b-a98f-0415b293b440

```
We can infer below from creating the cluster:
1. We got a loadbalancer(nginx lb) with the cluster (line 15) and can be reached at port 38871 on localhost (lines 19, 29)
2. We can provide `--api-port PORT` while creating a cluster to make sure lb always use that internally
3. k3d uses `containerd` runtime for running containers (lines 35, 42)
4. We can't share local docker images directly with k3d nodes, either we need to save local images to tar and import into k3d cluster or create a local registry
5. For accessing services from pods deployed in k3d cluster, we need to deploy ingress rules, controller and thus should have a rough idea of the services that we'll be using before creating the cluster itself or for testing/debugging we can use `kubectl port-forward` functionality

I highly recommend going through the [docs](https://k3d.io/) for customizing the cluster during creation, as I'm fine with defaults and mostly concerned with storage I didn't explore networking and other components enough in k3d to blog about.

As we don't want to pull images always from remote repository we'll be concentrating on point 4 from above for using local docker images.

> NOTE: If k3d nodes are [tainted, tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) inhibit pod scheduling, before scheduling any pods and after verifying nodes are online, remove taints by running following command:
``` json
# Verify presence of taints on the nodes (jq is a command line JSON Processor)
# kubectl get nodes -o json | jq '.items[].spec.taints'
[
  {
    "effect": "NoSchedule",
    "key": "node.cloudprovider.kubernetes.io/uninitialized",
    "value": "true"
  }
]
[
  {
    "effect": "NoSchedule",
    "key": "node.cloudprovider.kubernetes.io/uninitialized",
    "value": "true"
  }
]
[
  {
    "effect": "NoSchedule",
    "key": "node.cloudprovider.kubernetes.io/uninitialized",
    "value": "true"
  }
]
[
  {
    "effect": "NoSchedule",
    "key": "node.cloudprovider.kubernetes.io/uninitialized",
    "value": "true"
  }
]
```

If taints are found in above o/p, remove them by running ('-' at the end of command unset the value)

`# for name in $(kubectl get nodes -o jsonpath={'..name'}); do kubectl taint nodes $name node.cloudprovider.kubernetes.io/uninitialized-; done;`

## Optimizing workflow

We'll look at two scenarios of using local docker images in k3d cluster. One will be docker save and import into cluster, second is using a local registry. Both of the methods have use cases associated.

### Save and Import

Let's deploy a busybox container, find the image source from k3d container runtime and pull that image locally from docker.

``` yaml
# bat deployment-busybox.yaml --plain
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: test
  template:
    metadata:
      labels:
        app: test
    spec:
      containers:
      - name: test-pod
        image: busybox
        imagePullPolicy: IfNotPresent
        command:
          - '/bin/tail'
          - '-f'
          - '/dev/null'
        livenessProbe:
          exec:
            command:
              - 'sh'
              - '-ec'
              - 'df'
          initialDelaySeconds: 3
          periodSeconds: 3
```

Apply the manifest and verify pod creation, please not when a k3d cluster is created kubectl context is set to use newly created cluster, thus `kubectl` is able to access the Kubernetes API and it's resources without any manual interventions.

``` sh {linenos=table,hl_lines=[9],linenostart=1}
# kubectl apply -f deployment-busybox.yaml 
deployment.apps/test created

# kubectl get deploy test
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
test   1/1     1            1           82s

# k get pods -o wide | grep test
test-d77db976d-qxsvr          1/1     Running       0          2m46s   10.42.2.14   k3d-test-agent-1    <none>           <none>
```

We can see from above the pod is running on `k3d-test-agent-1`, now we'll query the image existing in that node and pull the image locally from remote repo/hub.

```sh
# docker exec k3d-test-agent-1 sh -c 'ctr image list -q | grep "busybox:latest"'
docker.io/library/busybox:latest

# Incase if you do not know the image name, you can query that pod spec
# kubectl get pod test-d77db976d-qxsvr -o jsonpath={'..image'}
docker.io/library/busybox:latest busybox

# Pulling image based on ctr images from k3d node
# for image in $(docker exec k3d-test-agent-1 sh -c 'ctr image list -q | grep "busybox:latest"'); do docker pull $image; done;
latest: Pulling from library/busybox
8b3d7e226fab: Pull complete 
Digest: sha256:ce2360d5189a033012fbad1635e037be86f23b65cfd676b436d0931af390a2ac
Status: Downloaded newer image for busybox:latest
docker.io/library/busybox:latest

# (or)

# Pulling image based on currently deployed pods
# for image in $(kubectl get pod test-d77db976d-qxsvr -o jsonpath="{..image}"); do docker pull $image; done;
Using default tag: latest
latest: Pulling from library/busybox
Digest: sha256:ce2360d5189a033012fbad1635e037be86f23b65cfd676b436d0931af390a2ac
Status: Image is up to date for busybox:latest
docker.io/library/busybox:latest
latest: Pulling from library/busybox
Digest: sha256:ce2360d5189a033012fbad1635e037be86f23b65cfd676b436d0931af390a2ac
Status: Image is up to date for busybox:latest
docker.io/library/busybox:latest

# Verify image exists in local docker
# docker images | grep busybox
busybox                                  latest         a9d583973f65   13 hours ago        1.23MB
busybox                                  stable         a9d583973f65   13 hours ago        1.23MB
```

Now that we have images pulled from repo/hub and exists locally, we can save them in a tar with correct tags and import them into k3d after the cluster is created

``` sh
# docker save $(docker images --format '{{.Repository}}:{{.Tag}}' | grep busybox) -o localimages.tar

# Delete earlier created cluster (or) you can create a new cluster and import above created tarball
# k3d cluster delete test
[...]

# k3d cluster create test
[...]

# Perform below before deploying busybox
# k3d image import -k localimages.tar -c test
[...]
```

After above operation, image existing in the k3d cluster is used for running container. `-k` option is for not deleting local tarball once uploaded to cluster and `-c` specifies the cluster name.

**Use case:**
- We deploy a [operator](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/) manifest and it may in turn pull many images from remote repository, we'll verify changes/perform operations using k3d cluster and delete the cluster.
- However, all the images pulled by operator will be deleted and next time if we create the cluster we need to pull images again which is not optimal.

**Caveat:**
- Busybox image is showed just as a demo and above can be followed for any other deployments, however the time increases based on image size
- Atleast the images has to pulled two times before using them in a new cluster and I wasn't able to find any other way to overcome that
- For images with lesser sizes and latest tags above method may not necessarily optimize network transactions and at the same time we can easily observe gains if we are dealing with larger images with versioned tags.

### Local Registry

As per the docs `k3d` has inbuilt capability for creating a registry associated with cluster itself however I'm just using docker for running a local registry and connecting k3d network with registry container.

Let's take a detour from k3d and use docker to build a image. I don't want to re-hash the details/[best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/) about building images as they are explained in greater detail in docker documentation, I recommend going through [storagedriver](https://docs.docker.com/storage/storagedriver/) and [multistage builds](https://docs.docker.com/storage/storagedriver/) at a minimum.

Let's build a minimal image which i generally use to verify checksum and create IO in a storage system and I'll touch upon some docker concepts along the way.

``` dockerfile {linenos=table,hl_lines=[6,7,9,11,12,14,16,18],linenostart=1}
# mkdir -p localimage && cd $_
# bat Dockerfile --plain
# Base image in https://github.com/Docker-Hub-frolvlad/docker-alpine-python3
FROM frolvlad/alpine-python3 AS compile
RUN apk add --no-cache gcc musl-dev git python3-dev && mkdir /opt/bin
RUN wget https://raw.githubusercontent.com/avati/arequal/master/arequal-checksum.c
RUN wget https://raw.githubusercontent.com/avati/arequal/master/arequal-run.sh -P /opt/bin/
RUN sed -i 's/bash/sh/' /opt/bin/arequal-run.sh
RUN gcc -o /opt/bin/arequal-checksum arequal-checksum.c && chmod +x /opt/bin/arequal*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install git+https://github.com/vijaykumar-koppad/Crefi.git@7c17a353d19666f230100e92141b49c29546e870

FROM frolvlad/alpine-python3 AS build
RUN apk add --no-cache rsync
COPY --from=compile /opt /opt

ENV PATH="/opt/venv/bin:/opt/bin:$PATH"
CMD ["sh"]
```

About above dockerfile:
- We need `gcc` to compile `C` src (#6) and even `Crefi` (#12) depends on `python3-dev` package for `Python.h` header file, however we just need resulting binary and installed python packages, so we are better off with using multistage builds (#14)
- Approach at #11 is quite helpful in isolating system packages and application packages using [virtual environment](https://pythonspeed.com/articles/activate-virtualenv-dockerfile/)
- As a result of operations at #7 and #11, the required binary and python packages are installed at `/opt/` and we just need this as part of final image
- Contents of `/opt` of `compile` image is copied to `/opt` of build image (#16) and PATH is set to `/opt` (#18) in final image.


Build the docker image and observe some other details after image creation
``` sh {linenos=table,hl_lines=[1,23,29,31],linenostart=1}
# docker build -t test-fs:latest .
Sending build context to Docker daemon   2.56kB
Step 1/14 : FROM frolvlad/alpine-python3 AS compile
latest: Pulling from frolvlad/alpine-python3
596ba82af5aa: Pull complete 
911eb5656b83: Pull complete 
Digest: sha256:69f108d85ddb473123c5fdae3f415aee900f0bccd2e78523f7ceba23a9688b0e
Status: Downloaded newer image for frolvlad/alpine-python3:latest
 ---> 80484c205b65
Step 2/14 : RUN apk add --no-cache gcc musl-dev git python3-dev && mkdir /opt/bin
 ---> Running in 273d48be6da8
 [...]
Removing intermediate container b20b7b5fb2dc
 ---> 98ccc0c7149f
Step 14/14 : CMD ["sh"]
 ---> Running in fcd348b9e8d6
Removing intermediate container fcd348b9e8d6
 ---> 901544a01eb2
Successfully built 901544a01eb2
Successfully tagged test-fs:latest

# docker images | grep fs
test-fs                                  latest         901544a01eb2   About a minute ago   72.8MB

# docker history test-fs
IMAGE          CREATED              CREATED BY                                      SIZE      COMMENT
901544a01eb2   About a minute ago   /bin/sh -c #(nop)  CMD ["sh"]                   0B
98ccc0c7149f   About a minute ago   /bin/sh -c #(nop)  ENV PATH=/opt/venv/bin:/o…   0B
22ed071e4b27   About a minute ago   /bin/sh -c #(nop) COPY dir:b4fca6fe0f106c874…   12.2MB
2864ccf4ba22   About a minute ago   /bin/sh -c apk add --no-cache rsync             1.56MB
80484c205b65   6 weeks ago          /bin/sh -c echo "**** install Python ****" &…   53.5MB
<missing>      6 weeks ago          /bin/sh -c #(nop)  ENV PYTHONUNBUFFERED=1       0B
<missing>      7 weeks ago          /bin/sh -c #(nop)  CMD ["/bin/sh"]              0B
<missing>      7 weeks ago          /bin/sh -c #(nop) ADD file:edbe213ae0c825a5b…   5.61MB
```
About above image creation:
- As a result of build command (#1) a image is generated from Dockerfile, tagged and stored locally (#23)
- The bulk of the image consists of Python executable (#31), size of binary and packages copied from `compile` stage is relatively less (#29)
- If we hadn't used multistaged build the image size could easily cross 250MB, I'm not after trimming image sizes indefinitely and so the result is good enough.

Well, that's it for the interlude, coming back to `k3d`, we'll follow below steps in brief:
- Start a local docker [registry](https://docs.docker.com/registry/deploying/) container, tag above created image
- Push that to local registry, inform `k3d` at the start of cluster creation to take a note of the registry
- Use images from the local registry in resource deployments.

``` sh
# Start registry container
# docker container run -d --name registry.localhost --restart always -p 5000:5000 registry:2

# Attach container to k3d cluster network
# docker network connect k3d-test registry.localhost

# Tag local image with local registry
# docker tag test-fs:latest registry.localhost:5000/test-fs:latest

# Push tagged image to local registry
# docker push registry.localhost:5000/test-fs:latest
```

After performing above operations, you can use `image: registry.localhost:5000/test-fs:latest` in deployment yaml file and use the image from local registry.

**Use case:**
- This greatly improves feedback loop while developing/unit testing applications using test pods.
- You can go a step ahead and replace all image definitions in yaml manifests to point to your local registry and never use save and import of images. (It's quite extreme though :sweat_smile:)

**Caveat:**
- I had to edit `dockerd` service file and reload systemctl to allow insecure-registries as adding to usual `daemon.json` file didn't work for me.
``` sh
# bat /usr/lib/systemd/system/docker.service  | grep ExecStart
ExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock --insecure-registry registry.localhost:5000
```
- Make sure you inform `k3d` about local registry while creating the cluster by mapping `registries.yaml` in `k3s` default directory as below:
``` yaml
# Create below file
# bat ~/.k3d/registries.yaml --plain
mirrors:
  "registry.localhost:5000":
    endpoint:
      - "http://registry.localhost:5000"

# Supply registries.yaml location while creating cluster
# k3d cluster create test -a 3 -v $HOME/.k3d/registries.yaml:/etc/rancher/k3s/registries.yaml
```

Well, that brings us to the end of the blog post. I covered only the setup and opinionated workflow while testing/debugging kubernetes workloads in k3d, intentionally left out the usage of local registry in resource deployments as I intend to cover that in a later post.

Stay tuned to learn about Container Storage Interface ([CSI](https://kubernetes-csi.github.io/docs/)) and how to work with CSI by deploying the resources in a k3d cluster.

All right, if you have come this far, thanks a lot for your time and I hope it is well spent. I'll be very happy to hear yours thoughts in the comments or you can contact me by any means mentioned in the footer :smile:

So long :wave:
